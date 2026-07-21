import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from '../utils/Logger';
import { spawnGui } from '../services/BuildRunner';
import { getToolchain } from '../services/toolchains/registry';
import { sourceDirsFromHwTcl } from '../utils/sourceFileMounts';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';
import { requireWorkspaceTrust } from '../utils/workspaceTrust';

const logger = new Logger('EditInPlatformDesigner');

export async function editInPlatformDesignerCommand(uri?: vscode.Uri): Promise<void> {
  if (!(await requireWorkspaceTrust())) {
    return;
  }

  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;

  if (!targetUri?.fsPath.endsWith('_hw.tcl')) {
    void vscode.window.showErrorMessage('No _hw.tcl file selected for Platform Designer.');
    return;
  }

  const hwTclPath = targetUri.fsPath;
  const alteraDir = path.dirname(hwTclPath);
  // Mount the IP root (parent of altera/) so relative paths like ../rtl/... in
  // the _hw.tcl resolve correctly inside Docker (/work/altera/../rtl → /work/rtl).
  const ipRootDir = path.dirname(alteraDir);
  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT);
  const toolchain = getToolchain('quartus');
  if (!toolchain) {
    return;
  }

  const qsysEdit = toolchain.resolve('qsys-edit', cfg);
  if (!qsysEdit) {
    return;
  }

  const docker = toolchain.getDocker(cfg, ipRootDir);
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
  // "." resolves to the cwd (alteraDir) in both local and Docker contexts —
  // spawnGui only translates pure absolute path args, not embedded paths inside
  // flag values, so "." is the only safe portable form here.
  // ,$ appends the standard Platform Designer IP catalog.
  const args = qsysPath ? [qsysPath, '--search-path=.,$'] : ['--search-path=.,$'];

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
