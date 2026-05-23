import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import * as vscode from 'vscode';
import { findInInstallDir } from '../utils/quartusResolver';

function isOnPath(toolName: string): boolean {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(cmd, [toolName], { stdio: 'pipe' }).status === 0;
}

function isAvailable(resolvedPath: string): boolean {
  return path.isAbsolute(resolvedPath) ? fs.existsSync(resolvedPath) : isOnPath(resolvedPath);
}

/**
 * Probes the configured tool paths and writes three VS Code context keys:
 *   ipcraft.vivadoFound    — vivado executable reachable
 *   ipcraft.quartusFound   — quartus_sh reachable (build + GUI live in the same dir)
 *   ipcraft.qsysEditFound  — qsys-edit reachable
 *
 * Call on extension activation and whenever ipcraft.vivadoPath or
 * ipcraft.quartus.installDir settings change.
 */
export function detectAndSetToolContext(): void {
  const config = vscode.workspace.getConfiguration('ipcraft');

  // Vivado: vivadoPath is a direct path to the executable (or empty → PATH)
  const vivadoPath = config.get<string>('vivadoPath', '').trim();
  const vivadoFound = vivadoPath ? isAvailable(vivadoPath) : isOnPath('vivado');

  // Quartus: installDir is the top-level directory; tools are resolved from it
  const installDir = config.get<string>('quartus.installDir', '').trim();
  let quartusFound: boolean;
  let qsysEditFound: boolean;

  if (installDir) {
    quartusFound = findInInstallDir('quartus_sh', installDir) !== null;
    qsysEditFound = findInInstallDir('qsys-edit', installDir) !== null;
  } else {
    quartusFound = isOnPath('quartus_sh');
    qsysEditFound = isOnPath('qsys-edit');
  }

  void vscode.commands.executeCommand('setContext', 'ipcraft.vivadoFound', vivadoFound);
  void vscode.commands.executeCommand('setContext', 'ipcraft.quartusFound', quartusFound);
  void vscode.commands.executeCommand('setContext', 'ipcraft.qsysEditFound', qsysEditFound);
}
