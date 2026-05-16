import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { Logger } from '../utils/Logger';

const logger = new Logger('OpenInQuartus');

export async function openInQuartusCommand(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;

  if (!targetUri?.fsPath.endsWith('.qpf')) {
    vscode.window.showErrorMessage('No Quartus project file (.qpf) selected.');
    return;
  }

  const qpfPath = targetUri.fsPath;

  const config = vscode.workspace.getConfiguration('ipcraft');
  const quartusGuiPath = (config.get<string>('quartus.guiPath') ?? 'quartus') || 'quartus';
  const dockerImage = (config.get<string>('quartus.dockerImage') ?? '').trim();

  const mountDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(qpfPath);

  let spawnExe: string;
  let spawnArgs: string[];

  if (dockerImage) {
    const x11Args = process.env.DISPLAY
      ? ['-e', `DISPLAY=${process.env.DISPLAY}`, '-v', '/tmp/.X11-unix:/tmp/.X11-unix']
      : [];

    spawnExe = 'docker';
    spawnArgs = [
      'run',
      '--rm',
      ...x11Args,
      '-v',
      `${mountDir}:${mountDir}`,
      '-w',
      path.dirname(qpfPath),
      dockerImage,
      quartusGuiPath,
      qpfPath,
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
      if (dockerImage) {
        vscode.window.showErrorMessage(
          `Could not find 'docker'. Is Docker installed and in your PATH?`
        );
      } else {
        vscode.window.showErrorMessage(
          `Could not find Quartus executable '${quartusGuiPath}'. Check the 'ipcraft.quartus.guiPath' setting.`
        );
      }
    } else {
      vscode.window.showErrorMessage(`Failed to open Quartus: ${err.message}`);
    }
  });

  child.unref();
}
