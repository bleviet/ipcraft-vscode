import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../utils/Logger';
import { spawnGui } from '../services/BuildRunner';
import { getToolchain } from '../services/toolchains/registry';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';

const logger = new Logger('OpenInQuartus');

export async function openInQuartusCommand(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;

  if (!targetUri?.fsPath.endsWith('.qpf')) {
    void vscode.window.showErrorMessage('No Quartus project file (.qpf) selected.');
    return;
  }

  const qpfPath = targetUri.fsPath;
  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
  const toolchain = getToolchain('quartus');
  if (!toolchain) {
    return;
  }

  const guiExe = toolchain.resolve('quartus', cfg);
  if (!guiExe?.exe) {
    return;
  }

  // BuildRunner mounts ipDir as /work when compiling, so generated .qsf files
  // contain absolute paths like /work/rtl/... The .qpf lives in
  // {ipDir}/altera/build/, so ipDir is two levels up. Use that same convention
  // so the GUI can resolve the same paths.
  const mountBase = path.resolve(path.dirname(qpfPath), '../..');
  const docker = toolchain.getDocker(cfg, mountBase);
  const { env, extraMounts } = toolchain.getLaunchEnv(cfg);

  logger.info(`Opening Quartus project: ${qpfPath}`);

  spawnGui(
    guiExe.exe,
    [qpfPath],
    { cwd: path.dirname(qpfPath), docker, env, extraMounts },
    toolchain.displayName
  );
}
