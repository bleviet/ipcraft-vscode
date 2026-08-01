import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../utils/Logger';
import { spawnGui } from '../services/BuildRunner';
import { getToolchain } from '../services/toolchains/registry';
import { resolveExecutionLauncher } from '../services/toolchains/LaunchableTool';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';
import { requireWorkspaceTrust } from '../utils/workspaceTrust';
import { resolveToolchainVersionForOpen } from '../services/toolchains/resolveToolchainVersion';

const logger = new Logger('OpenInQuartus');

export async function openInQuartusCommand(uri?: vscode.Uri): Promise<void> {
  if (!(await requireWorkspaceTrust())) {
    return;
  }

  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;

  if (!targetUri?.fsPath.endsWith('.qpf')) {
    void vscode.window.showErrorMessage('No Quartus project file (.qpf) selected.');
    return;
  }

  const qpfPath = targetUri.fsPath;
  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT, targetUri);
  const toolchain = getToolchain('quartus');
  if (!toolchain) {
    return;
  }

  const choice = await resolveToolchainVersionForOpen(cfg, 'quartus', qpfPath);
  if (choice === undefined) {
    return;
  }
  // `null` means nothing is configured under the new multi-version settings —
  // fall back to legacy/PATH resolution instead of aborting.
  // BuildRunner mounts ipDir as /work when compiling, so generated .qsf files
  // contain absolute paths like /work/rtl/... The .qpf lives in
  // {ipDir}/altera/build/, so ipDir is two levels up. Use that same convention
  // so the GUI can resolve the same paths.
  const mountBase = path.resolve(path.dirname(qpfPath), '../..');
  const docker = toolchain.getDocker(cfg, mountBase, choice?.version);
  const guiExe = resolveExecutionLauncher(docker, 'quartus', () =>
    toolchain.resolve('quartus', cfg, choice?.version)
  );
  if (!guiExe?.exe) {
    return;
  }
  const { env, extraMounts } = toolchain.getLaunchEnv(cfg);

  logger.info(`Opening Quartus project: ${qpfPath}`);

  spawnGui(
    guiExe.exe,
    [qpfPath],
    { cwd: path.dirname(qpfPath), docker, env, extraMounts },
    toolchain.displayName
  );
}
