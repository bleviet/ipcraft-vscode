import { spawnSync } from 'child_process';
import * as vscode from 'vscode';
import { findInInstallDir } from '../utils/quartusResolver';
import { findVivadoInInstallDir } from '../utils/vivadoResolver';

function isOnPath(toolName: string): boolean {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(cmd, [toolName], { stdio: 'pipe' }).status === 0;
}

/**
 * Probes the configured tool paths and writes three VS Code context keys:
 *   ipcraft.vivadoFound    — vivado executable reachable
 *   ipcraft.quartusFound   — quartus_sh reachable (build + GUI live in the same dir)
 *   ipcraft.qsysEditFound  — qsys-edit reachable
 *
 * Call on extension activation and whenever ipcraft.vivado.installDir or
 * ipcraft.quartus.installDir settings change.
 */
export function detectAndSetToolContext(): void {
  const config = vscode.workspace.getConfiguration('ipcraft');

  const vivadoRunner = config.get<string>('vivado.runner', 'local');
  const vivadoInstallDir = config.get<string>('vivado.installDir', '').trim();
  const vivadoDockerImage = config.get<string>('vivado.dockerImage', '').trim();
  const vivadoFound =
    vivadoRunner === 'docker'
      ? vivadoDockerImage.length > 0
      : vivadoInstallDir
        ? findVivadoInInstallDir(vivadoInstallDir) !== null
        : isOnPath('vivado');

  // Quartus: installDir is the top-level directory; tools are resolved from it.
  // A configured Docker image also counts as "found" — the tools live inside
  // the container so there is nothing to probe on the host.
  const quartusRunner = config.get<string>('quartus.runner', 'local');
  const installDir = config.get<string>('quartus.installDir', '').trim();
  const quartusDockerImage = config.get<string>('quartus.dockerImage', '').trim();
  let quartusFound: boolean;
  let qsysEditFound: boolean;

  if (quartusRunner === 'docker') {
    quartusFound = quartusDockerImage.length > 0;
    qsysEditFound = quartusDockerImage.length > 0;
  } else if (installDir) {
    quartusFound = findInInstallDir('quartus_sh', installDir) !== null;
    qsysEditFound = findInInstallDir('qsys-edit', installDir) !== null;
  } else if (quartusDockerImage) {
    quartusFound = true;
    qsysEditFound = true;
  } else {
    quartusFound = isOnPath('quartus_sh');
    qsysEditFound = isOnPath('qsys-edit');
  }

  void vscode.commands.executeCommand('setContext', 'ipcraft.vivadoFound', vivadoFound);
  void vscode.commands.executeCommand('setContext', 'ipcraft.quartusFound', quartusFound);
  void vscode.commands.executeCommand('setContext', 'ipcraft.qsysEditFound', qsysEditFound);
}
