import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';

// On Windows, Vivado must be launched through vvgl.exe with vivado.bat as the first
// argument — running vivado.bat directly skips the wrapper that sets up the environment.
// On Linux, the plain vivado binary in bin/ is the correct entry point.
const WIN_LAUNCHER_SUBPATH = path.join('bin', 'unwrapped', 'win64.o', 'vvgl.exe');
const WIN_SCRIPT_SUBPATH = path.join('bin', 'vivado.bat');
const LINUX_BIN_SUBPATH = path.join('bin', 'vivado');

export interface VivadoLauncher {
  /** The executable to spawn (vvgl.exe on Windows, vivado binary on Linux). */
  exe: string;
  /**
   * Arguments to prepend before the actual tool arguments.
   * On Windows this is [path/to/vivado.bat]; empty on Linux.
   */
  prefixArgs: string[];
}

/**
 * Searches `installDir` for the Vivado launcher.
 *
 * Expected layouts (tried in order):
 *   Windows — <installDir>/bin/unwrapped/win64.o/vvgl.exe  +  <installDir>/bin/vivado.bat
 *             <installDir>/bin/vivado.bat                      (fallback, no wrapper)
 *   Linux   — <installDir>/bin/vivado
 *
 * Returns null if no matching executable is found.
 */
export function findVivadoInInstallDir(installDir: string): VivadoLauncher | null {
  const isWindows = process.platform === 'win32';

  if (isWindows) {
    const launcher = path.join(installDir, WIN_LAUNCHER_SUBPATH);
    const script = path.join(installDir, WIN_SCRIPT_SUBPATH);
    if (fs.existsSync(launcher) && fs.existsSync(script)) {
      return { exe: launcher, prefixArgs: [script] };
    }
    if (fs.existsSync(script)) {
      return { exe: script, prefixArgs: [] };
    }
  } else {
    const binary = path.join(installDir, LINUX_BIN_SUBPATH);
    if (fs.existsSync(binary)) {
      return { exe: binary, prefixArgs: [] };
    }
  }

  return null;
}

/**
 * Returns the launcher for the Vivado executable.
 *
 * Resolution order:
 *  1. `ipcraft.vivado.installDir` — searches the installation directory for vivado
 *  2. `'vivado'`                  — relies on PATH
 */
export function getVivadoLauncher(config: vscode.WorkspaceConfiguration): VivadoLauncher {
  const installDir = config.get<string>('vivado.installDir', '').trim();
  if (installDir) {
    const found = findVivadoInInstallDir(installDir);
    if (found) {
      return found;
    }
  }

  return { exe: 'vivado', prefixArgs: [] };
}
