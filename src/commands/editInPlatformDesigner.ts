import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
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
  const alteraDir = path.dirname(hwTclPath);
  const cfg = vscode.workspace.getConfiguration('ipcraft');
  const toolchain = getToolchain('quartus');
  if (!toolchain) {
    return;
  }

  const qsysEdit = toolchain.resolve('qsys-edit', cfg);
  if (!qsysEdit) {
    return;
  }

  const docker = toolchain.getDocker(cfg, alteraDir);
  const { env, extraMounts } = toolchain.getLaunchEnv(cfg);

  // Mount source directories referenced in the _hw.tcl so Platform Designer
  // can locate RTL files when analysing the component.
  const sourceDirs = await sourceDirsFromHwTcl(hwTclPath);
  const extraSourceMounts = sourceDirs
    .filter((d) => d !== alteraDir)
    .map((d) => ({ host: d, container: d }));

  // Find an existing Platform Designer project (.qsys) in the altera directory.
  const entries = await fs.readdir(alteraDir).catch(() => [] as string[]);
  const qsysFile = entries.find((e) => e.endsWith('.qsys'));
  const qsysPath = qsysFile ? path.join(alteraDir, qsysFile) : undefined;

  // Open Platform Designer (not the Component Editor).
  // Append ,$ to include the standard Platform Designer IP catalog alongside the
  // custom altera/ directory. Without $, all built-in Altera/Intel IPs are omitted.
  // If a .qsys project exists it is opened directly; otherwise a blank new project starts.
  const searchPath = `${alteraDir},$`;
  const args = qsysPath
    ? [qsysPath, `--search-path=${searchPath}`]
    : [`--search-path=${searchPath}`];

  logger.info(
    `Opening Platform Designer: ${qsysPath ?? '(new project)'} [search-path: ${alteraDir}]`
  );

  spawnGui(
    qsysEdit.exe,
    args,
    {
      cwd: alteraDir,
      docker,
      env,
      extraMounts: [...extraMounts, ...extraSourceMounts],
    },
    'Platform Designer'
  );
}
