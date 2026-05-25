import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { Logger } from '../utils/Logger';
import { getVivadoLauncher } from '../utils/vivadoResolver';
import { sourceDirsFromComponentXml, buildMountArgs } from '../utils/sourceFileMounts';

const logger = new Logger('EditInIpPackager');

export async function editInIpPackagerCommand(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;

  if (!targetUri?.fsPath.endsWith('component.xml')) {
    vscode.window.showErrorMessage('No component.xml selected for IP Packager.');
    return;
  }

  const componentPath = targetUri.fsPath.replace(/\\/g, '/');

  const config = vscode.workspace.getConfiguration('ipcraft');
  const launcher = getVivadoLauncher(config);
  const vivadoRunner = config.get<string>('vivado.runner', 'local');
  const vivadoDockerImage = (config.get<string>('vivado.dockerImage') ?? '').trim();
  const useDocker = vivadoRunner === 'docker';

  try {
    // Create a temporary directory in the system tmp folder
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ipcraft-vivado-'));
    const tempProjectDir = path.join(tmpDir, 'edit_ip_project').replace(/\\/g, '/');
    const tclScriptPath = path.join(tmpDir, 'open_ip.tcl');

    // Create the Tcl script to open the IP in Vivado Packager.
    // create_project -in_memory provides the project context that
    // ipx::edit_ip_in_project requires without writing any project files.
    const tclScript =
      [
        `create_project -force -in_memory`,
        `ipx::edit_ip_in_project -name edit_ip_project -directory {${tempProjectDir}} {${componentPath}}`,
      ].join('\n') + '\n';
    await fs.writeFile(tclScriptPath, tclScript, 'utf8');

    let spawnExe: string;
    let spawnArgs: string[];

    if (useDocker) {
      // Mount tmpDir, the component.xml directory, and any source file
      // directories referenced inside component.xml at their exact host paths
      // so the pre-written TCL script (which contains absolute paths) works unchanged.
      const componentDir = path.dirname(componentPath);
      const x11Args: string[] = process.env.DISPLAY
        ? ['-e', `DISPLAY=${process.env.DISPLAY}`, '-v', '/tmp/.X11-unix:/tmp/.X11-unix']
        : [];
      const extraDirs = await sourceDirsFromComponentXml(componentPath);
      const extraMounts = buildMountArgs(extraDirs.filter((d) => d !== componentDir));

      spawnExe = 'docker';
      spawnArgs = [
        'run',
        '--rm',
        ...x11Args,
        '-v',
        `${tmpDir}:${tmpDir}`,
        '-v',
        `${componentDir}:${componentDir}`,
        ...extraMounts,
        '-w',
        tmpDir,
        vivadoDockerImage,
        launcher.exe,
        '-mode',
        'gui',
        '-source',
        tclScriptPath,
      ];
    } else {
      spawnExe = launcher.exe;
      spawnArgs = [...launcher.prefixArgs, '-mode', 'gui', '-source', tclScriptPath];
    }

    logger.info(`Launching vivado: ${spawnExe} ${spawnArgs.join(' ')}`);

    // Spawn Vivado (detached so it outlives VS Code)
    const child = spawn(spawnExe, spawnArgs, {
      cwd: tmpDir,
      detached: true,
      stdio: 'ignore',
    });

    child.on('error', (err: Error & { code?: string }) => {
      logger.error(`Failed to start Vivado: ${err.message}`);
      if (err.code === 'ENOENT') {
        if (useDocker) {
          vscode.window.showErrorMessage(
            `Could not find 'docker'. Is Docker installed and in your PATH?`
          );
        } else {
          vscode.window.showErrorMessage(
            `Could not find Vivado executable '${launcher.exe}'. Please check the 'ipcraft.vivado.installDir' setting.`
          );
        }
      } else {
        vscode.window.showErrorMessage(`Failed to start Vivado: ${err.message}`);
      }
    });

    child.unref();
  } catch (error) {
    logger.error('Error preparing Vivado IP Packager launch', error as Error);
    vscode.window.showErrorMessage(`Failed to launch IP Packager: ${(error as Error).message}`);
  }
}
