import * as vscode from 'vscode';
import { spawnSync } from 'child_process';
import { listAll } from './toolchains/registry';
import { findInInstallDir } from '../utils/quartusResolver';

/**
 * Probes all registered synthesis toolchains and writes VS Code context keys so
 * menus and enablement clauses stay up to date. Also sets the legacy
 * `ipcraft.qsysEditFound` key which is not covered by the generic toolchain
 * availability check.
 *
 * Call on extension activation and whenever any `ipcraft.*` settings change.
 */
export function detectAndSetToolContext(): void {
  const cfg = vscode.workspace.getConfiguration('ipcraft');

  for (const toolchain of listAll()) {
    const available = toolchain.isAvailable(cfg);
    void vscode.commands.executeCommand('setContext', toolchain.contextKey, available);
  }

  // qsys-edit is a sub-tool of Quartus but has its own context key for the
  // Platform Designer menu item. Derive it from the same installDir heuristic.
  const quartusRunner = cfg.get<string>('quartus.runner', 'local');
  const installDir = cfg.get<string>('quartus.installDir', '').trim();
  const quartusDockerImage = cfg.get<string>('quartus.dockerImage', '').trim();
  let qsysEditFound: boolean;

  if (quartusRunner === 'docker') {
    qsysEditFound = quartusDockerImage.length > 0;
  } else if (installDir) {
    qsysEditFound = findInInstallDir('qsys-edit', installDir) !== null;
  } else if (quartusDockerImage) {
    qsysEditFound = true;
  } else {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    qsysEditFound = spawnSync(cmd, ['qsys-edit'], { stdio: 'pipe' }).status === 0;
  }

  void vscode.commands.executeCommand('setContext', 'ipcraft.qsysEditFound', qsysEditFound);
}
