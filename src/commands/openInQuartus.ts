import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { Logger } from '../utils/Logger';
import { getQuartusTool } from '../utils/quartusResolver';

const logger = new Logger('OpenInQuartus');

export async function openInQuartusCommand(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;

  if (!targetUri?.fsPath.endsWith('.qpf')) {
    vscode.window.showErrorMessage('No Quartus project file (.qpf) selected.');
    return;
  }

  const qpfPath = targetUri.fsPath;

  const config = vscode.workspace.getConfiguration('ipcraft');
  const quartusGuiPath = getQuartusTool(config, 'quartus');
  const quartusRunner = config.get<string>('quartus.runner', 'local');
  const dockerImage = (config.get<string>('quartus.dockerImage') ?? '').trim();
  const useDocker = quartusRunner === 'docker';

  // BuildRunner mounts ipDir as /work when compiling, so generated .qsf files
  // contain absolute paths like /work/rtl/...  The .qpf is always written to
  // {ipDir}/altera/build/, so ipDir is two levels up from the .qpf.  Use that
  // same mount convention here so Quartus GUI can resolve those paths.
  const mountBase = path.resolve(path.dirname(qpfPath), '../..');
  const CONTAINER_MOUNT = '/work';
  const toContainer = (hostPath: string) =>
    CONTAINER_MOUNT + '/' + path.relative(mountBase, hostPath).replace(/\\/g, '/');

  let spawnExe: string;
  let spawnArgs: string[];

  if (useDocker) {
    const x11Args = process.env.DISPLAY
      ? ['-e', `DISPLAY=${process.env.DISPLAY}`, '-v', '/tmp/.X11-unix:/tmp/.X11-unix']
      : [];

    spawnExe = 'docker';
    spawnArgs = [
      'run',
      '--rm',
      ...x11Args,
      '-v',
      `${mountBase}:${CONTAINER_MOUNT}`,
      '-w',
      toContainer(path.dirname(qpfPath)),
      dockerImage,
      quartusGuiPath,
      toContainer(qpfPath),
    ];
  } else {
    spawnExe = quartusGuiPath;
    spawnArgs = [qpfPath];
  }

  logger.info(`Opening Quartus project: ${spawnExe} ${spawnArgs.join(' ')}`);

  const child = spawn(spawnExe, spawnArgs, {
    cwd: path.dirname(qpfPath),
    detached: true,
    stdio: 'ignore',
  });

  child.on('error', (err: Error & { code?: string }) => {
    logger.error(`Failed to open Quartus: ${err.message}`);
    if (err.code === 'ENOENT') {
      if (useDocker) {
        vscode.window.showErrorMessage(
          `Could not find 'docker'. Is Docker installed and in your PATH?`
        );
      } else {
        vscode.window.showErrorMessage(
          `Could not find Quartus executable '${quartusGuiPath}'. ` +
            `Set 'ipcraft.quartus.installDir' or 'ipcraft.quartus.guiPath'.`
        );
      }
    } else {
      vscode.window.showErrorMessage(`Failed to open Quartus: ${err.message}`);
    }
  });

  child.unref();
}
