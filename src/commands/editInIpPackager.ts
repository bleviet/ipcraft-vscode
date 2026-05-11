import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { spawn } from 'child_process';
import { Logger } from '../utils/Logger';

const logger = new Logger('EditInIpPackager');

export async function editInIpPackagerCommand(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;

  if (!targetUri?.fsPath.endsWith('component.xml')) {
    vscode.window.showErrorMessage('No component.xml selected for IP Packager.');
    return;
  }

  const componentPath = targetUri.fsPath.replace(/\\/g, '/');

  // Get Vivado path from config
  const config = vscode.workspace.getConfiguration('ipcraft');
  const vivadoPath = config.get<string>('vivadoPath', 'vivado');

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

    logger.info(`Launching vivado: ${vivadoPath} -mode gui -source ${tclScriptPath}`);

    // Spawn Vivado
    const child = spawn(vivadoPath, ['-mode', 'gui', '-source', tclScriptPath], {
      cwd: tmpDir,
      detached: true,
      stdio: 'ignore',
    });

    child.on('error', (err: Error & { code?: string }) => {
      logger.error(`Failed to start Vivado: ${err.message}`);
      if (err.code === 'ENOENT') {
        vscode.window.showErrorMessage(
          `Could not find Vivado executable '${vivadoPath}'. Please check the 'ipcraft.vivadoPath' setting.`
        );
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
