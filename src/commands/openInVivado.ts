import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../utils/Logger';
import { spawnGui } from '../services/BuildRunner';
import { getToolchain } from '../services/toolchains/registry';

const logger = new Logger('OpenInVivado');

export async function openInVivadoCommand(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;

  if (!targetUri?.fsPath.endsWith('.xpr')) {
    void vscode.window.showErrorMessage('No Vivado project file (.xpr) selected.');
    return;
  }

  const xprPath = targetUri.fsPath;
  const cfg = vscode.workspace.getConfiguration('ipcraft');
  const toolchain = getToolchain('vivado');
  if (!toolchain) {
    return;
  }

  const launcher = toolchain.resolve('vivado', cfg);
  if (!launcher) {
    return;
  }

  // Mount the workspace root so Vivado can resolve all source paths stored as
  // absolute references inside the .xpr.
  const mountDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(xprPath);
  const docker = toolchain.getDocker(cfg, mountDir);
  const { env, extraMounts } = toolchain.getLaunchEnv(cfg);

  logger.info(`Opening Vivado project: ${xprPath}`);

  spawnGui(
    launcher.exe,
    [...launcher.prefixArgs, xprPath],
    { cwd: path.dirname(xprPath), docker, env, extraMounts },
    toolchain.displayName
  );
}
