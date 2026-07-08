import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { Logger } from '../utils/Logger';
import { spawnGui } from '../services/BuildRunner';
import { getToolchain } from '../services/toolchains/registry';
import { sourceDirsFromComponentXml } from '../utils/sourceFileMounts';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';

const logger = new Logger('EditInIpPackager');

export async function editInIpPackagerCommand(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;

  if (!targetUri?.fsPath.endsWith('component.xml')) {
    void vscode.window.showErrorMessage('No component.xml selected for IP Packager.');
    return;
  }

  const componentPath = targetUri.fsPath.replace(/\\/g, '/');
  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
  const toolchain = getToolchain('vivado');
  if (!toolchain) {
    return;
  }

  const launcher = toolchain.resolve('vivado', cfg);
  if (!launcher) {
    return;
  }

  try {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vivado-'));
    const tempProjectDir = path.join(tmpDir, 'edit_ip_project').replace(/\\/g, '/');

    // create_project -in_memory gives the project context that
    // ipx::edit_ip_in_project needs without writing any project files.
    const tclScript =
      [
        `create_project -force -in_memory`,
        `ipx::edit_ip_in_project -name edit_ip_project -directory {${tempProjectDir}} {${componentPath}}`,
      ].join('\n') + '\n';
    const tclScriptPath = path.join(tmpDir, 'open_ip.tcl');
    await fs.writeFile(tclScriptPath, tclScript, 'utf8');

    const componentDir = path.dirname(componentPath);
    const docker = toolchain.getDocker(cfg, tmpDir);
    const { env, extraMounts } = toolchain.getLaunchEnv(cfg);

    // Extra source dirs referenced inside component.xml need to be mounted at
    // their exact host paths so the pre-written TCL (with absolute paths) works.
    const sourceDirs = await sourceDirsFromComponentXml(componentPath);
    const extraComponentMounts = sourceDirs
      .filter((d) => d !== componentDir)
      .map((d) => ({ host: d, container: d }));

    logger.info(`Launching Vivado IP Packager for ${componentPath}`);

    spawnGui(
      launcher.exe,
      [...launcher.prefixArgs, '-mode', 'gui', '-source', tclScriptPath],
      {
        cwd: tmpDir,
        docker,
        env,
        extraMounts: [
          ...extraMounts,
          ...extraComponentMounts,
          { host: componentDir, container: componentDir },
        ],
      },
      toolchain.displayName
    );
  } catch (error) {
    logger.error('Error preparing Vivado IP Packager launch', error as Error);
    void vscode.window.showErrorMessage(
      `Failed to launch IP Packager: ${(error as Error).message}`
    );
  }
}
