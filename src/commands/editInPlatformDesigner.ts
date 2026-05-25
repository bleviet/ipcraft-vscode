import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../utils/Logger';
import { spawnGui } from '../services/BuildRunner';
import { getToolchain } from '../services/toolchains/registry';
import { sourceDirsFromHwTcl } from '../utils/sourceFileMounts';

const logger = new Logger('EditInPlatformDesigner');

export async function editInPlatformDesignerCommand(uri?: vscode.Uri): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;

  if (!targetUri?.fsPath.endsWith('_hw.tcl')) {
    void vscode.window.showErrorMessage('No _hw.tcl file selected for Platform Designer.');
    return;
  }

  const hwTclPath = targetUri.fsPath;
  const hwTclDir = path.dirname(hwTclPath);
  const cfg = vscode.workspace.getConfiguration('ipcraft');
  const toolchain = getToolchain('quartus');
  if (!toolchain) {
    return;
  }

  const qsysEdit = toolchain.resolve('qsys-edit', cfg);
  if (!qsysEdit) {
    return;
  }

  const docker = toolchain.getDocker(cfg, hwTclDir);
  const { env, extraMounts } = toolchain.getLaunchEnv(cfg);

  // Mount extra source directories referenced inside the _hw.tcl at their exact
  // host paths so no path translation is needed for --search-path.
  const sourceDirs = await sourceDirsFromHwTcl(hwTclPath);
  const extraSourceMounts = sourceDirs
    .filter((d) => d !== hwTclDir)
    .map((d) => ({ host: d, container: d }));

  logger.info(`Launching Platform Designer: ${hwTclPath}`);

  spawnGui(
    qsysEdit.exe,
    [hwTclPath, `--search-path=${hwTclDir}`],
    {
      cwd: hwTclDir,
      docker,
      env,
      extraMounts: [...extraMounts, ...extraSourceMounts],
    },
    'Platform Designer'
  );
}
