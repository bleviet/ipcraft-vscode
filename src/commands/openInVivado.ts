import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { Logger } from '../utils/Logger';

const logger = new Logger('OpenInVivado');

export async function openInVivadoCommand(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;

  if (!targetUri?.fsPath.endsWith('.xpr')) {
    vscode.window.showErrorMessage('No Vivado project file (.xpr) selected.');
    return;
  }

  const xprPath = targetUri.fsPath;

  const config = vscode.workspace.getConfiguration('ipcraft');
  const vivadoPath = (config.get<string>('vivadoPath') ?? 'vivado') || 'vivado';
  const dockerImage = (config.get<string>('vivado.dockerImage') ?? '').trim();

  // Mount the workspace root so Vivado can resolve all source paths it stored
  // as absolute references inside the .xpr file.
  const mountDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(xprPath);

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
      path.dirname(xprPath),
      dockerImage,
      vivadoPath,
      xprPath,
    ];
  } else {
    spawnExe = vivadoPath;
    spawnArgs = [xprPath];
  }

  logger.info(`Opening Vivado project: ${spawnExe} ${spawnArgs.join(' ')}`);

  const child = spawn(spawnExe, spawnArgs, {
    cwd: path.dirname(xprPath),
    detached: true,
    stdio: 'ignore',
  });

  child.on('error', (err: Error & { code?: string }) => {
    logger.error(`Failed to open Vivado: ${err.message}`);
    if (err.code === 'ENOENT') {
      if (dockerImage) {
        vscode.window.showErrorMessage(
          `Could not find 'docker'. Is Docker installed and in your PATH?`
        );
      } else {
        vscode.window.showErrorMessage(
          `Could not find Vivado executable '${vivadoPath}'. Check the 'ipcraft.vivadoPath' setting.`
        );
      }
    } else {
      vscode.window.showErrorMessage(`Failed to open Vivado: ${err.message}`);
    }
  });

  child.unref();
}
