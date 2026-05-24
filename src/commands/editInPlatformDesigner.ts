import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { Logger } from '../utils/Logger';
import { getQuartusTool } from '../utils/quartusResolver';
import { sourceDirsFromHwTcl, buildMountArgs } from '../utils/sourceFileMounts';

const logger = new Logger('EditInPlatformDesigner');

export async function editInPlatformDesignerCommand(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;

  if (!targetUri?.fsPath.endsWith('_hw.tcl')) {
    vscode.window.showErrorMessage('No _hw.tcl file selected for Platform Designer.');
    return;
  }

  const hwTclPath = targetUri.fsPath;
  const hwTclDir = path.dirname(hwTclPath);

  const config = vscode.workspace.getConfiguration('ipcraft');
  const qsysEditPath = getQuartusTool(config, 'qsys-edit');
  const dockerImage = (config.get<string>('quartus.dockerImage') ?? '').trim();

  let spawnExe: string;
  let spawnArgs: string[];

  if (dockerImage) {
    // Mount the _hw.tcl directory and any source file directories referenced
    // inside the _hw.tcl at their exact host paths so no path translation is
    // needed for the --search-path argument.
    const x11Args: string[] = process.env.DISPLAY
      ? ['-e', `DISPLAY=${process.env.DISPLAY}`, '-v', '/tmp/.X11-unix:/tmp/.X11-unix']
      : [];
    const extraDirs = await sourceDirsFromHwTcl(hwTclPath);
    const extraMounts = buildMountArgs(extraDirs.filter((d) => d !== hwTclDir));

    spawnExe = 'docker';
    spawnArgs = [
      'run',
      '--rm',
      ...x11Args,
      '-v',
      `${hwTclDir}:${hwTclDir}`,
      ...extraMounts,
      '-w',
      hwTclDir,
      dockerImage,
      qsysEditPath,
      hwTclPath,
      `--search-path=${hwTclDir}`,
    ];
  } else {
    spawnExe = qsysEditPath;
    spawnArgs = [hwTclPath, `--search-path=${hwTclDir}`];
  }

  logger.info(`Launching Platform Designer: ${spawnExe} ${spawnArgs.join(' ')}`);

  const child = spawn(spawnExe, spawnArgs, {
    cwd: hwTclDir,
    detached: true,
    stdio: 'ignore',
  });

  child.on('error', (err: Error & { code?: string }) => {
    logger.error(`Failed to start Platform Designer: ${err.message}`);
    if (err.code === 'ENOENT') {
      if (dockerImage) {
        vscode.window.showErrorMessage(
          `Could not find 'docker'. Is Docker installed and in your PATH?`
        );
      } else {
        vscode.window.showErrorMessage(
          `Could not find Platform Designer executable '${qsysEditPath}'. ` +
            `Set 'ipcraft.quartus.installDir' or 'ipcraft.quartus.qsysEditPath'.`
        );
      }
    } else {
      vscode.window.showErrorMessage(`Failed to start Platform Designer: ${err.message}`);
    }
  });

  child.unref();
}
