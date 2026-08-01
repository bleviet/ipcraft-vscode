import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';
import { detectVivadoVersionAt } from './detectVivadoVersion';
import { compareVersions } from './toolchainVersions';

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

function hasVivadoBinary(dir: string, isWindows: boolean): boolean {
  const script = path.join(dir, isWindows ? WIN_SCRIPT_SUBPATH : LINUX_BIN_SUBPATH);
  return fs.existsSync(script);
}

/**
 * Resolves `installDir` to the actual version-specific Vivado installation directory
 * (the one containing `data/`, `bin/`, etc.), independent of how the executable is
 * launched on each platform. Used both to locate the launcher and to read static
 * resources Vivado ships on disk (e.g. `data/ip/interfaces/`).
 *
 * Expected layouts (tried in order):
 *   - installDir IS the version-specific directory (user set the version-specific dir)
 *   - installDir is the Vivado family directory containing versioned subdirectories
 *     (e.g. /tools/Xilinx/Vivado/2024.2/) — the latest version is picked
 *     (lexicographic descending — Xilinx uses YYYY.N).
 *
 * Returns null if no Vivado installation can be found under installDir.
 */
export function resolveVivadoInstallDir(installDir: string): string | null {
  const isWindows = process.platform === 'win32';

  if (hasVivadoBinary(installDir, isWindows)) {
    return installDir;
  }

  try {
    const entries = fs.readdirSync(installDir);
    const candidates = entries
      .filter((e) => hasVivadoBinary(path.join(installDir, e), isWindows))
      .sort()
      .reverse();
    if (candidates.length > 0) {
      return path.join(installDir, candidates[0]);
    }
  } catch {
    // installDir doesn't exist or isn't readable.
  }

  return null;
}

/**
 * Searches `installDir` for the Vivado launcher.
 *
 * Expected layouts (tried in order):
 *   Windows — <installDir>/bin/unwrapped/win64.o/vvgl.exe  +  <installDir>/bin/vivado.bat
 *             <installDir>/bin/vivado.bat                      (fallback, no wrapper)
 *   Linux   — <installDir>/bin/vivado           (user set the version-specific dir)
 *             <installDir>/<version>/bin/vivado  (user set the Vivado family dir)
 *
 * Returns null if no matching executable is found.
 */
export function findVivadoInInstallDir(installDir: string): VivadoLauncher | null {
  const resolvedDir = resolveVivadoInstallDir(installDir);
  if (!resolvedDir) {
    return null;
  }

  const isWindows = process.platform === 'win32';
  if (isWindows) {
    const launcher = path.join(resolvedDir, WIN_LAUNCHER_SUBPATH);
    const script = path.join(resolvedDir, WIN_SCRIPT_SUBPATH);
    if (fs.existsSync(launcher) && fs.existsSync(script)) {
      return { exe: launcher, prefixArgs: [script] };
    }
    if (fs.existsSync(script)) {
      return { exe: script, prefixArgs: [] };
    }
    return null;
  }

  return { exe: path.join(resolvedDir, LINUX_BIN_SUBPATH), prefixArgs: [] };
}

export interface ResolvedVivadoVersion {
  version: string;
  installDir: string;
  launcher: VivadoLauncher;
}

/**
 * Resolves each entry in `installDirs` to its version label (probed via
 * `-version`, falling back to the resolved directory's folder name) and
 * launcher. Entries that don't resolve to a real Vivado install are skipped.
 */
export function resolveVivadoVersions(installDirs: string[]): ResolvedVivadoVersion[] {
  const results: ResolvedVivadoVersion[] = [];
  for (const dir of installDirs) {
    const launcher = findVivadoInInstallDir(dir);
    const resolvedDir = resolveVivadoInstallDir(dir);
    if (!launcher || !resolvedDir) {
      continue;
    }
    const probed = detectVivadoVersionAt(launcher.exe, launcher.prefixArgs);
    results.push({
      version: probed ?? path.basename(resolvedDir),
      installDir: resolvedDir,
      launcher,
    });
  }
  return results;
}

/**
 * Returns the launcher for the Vivado executable.
 *
 * Resolution order:
 *  1. `ipcraft.vivado.installDirs` — multi-version array; picks `preferredVersion`
 *     if given and configured, else the latest configured version.
 *  2. `ipcraft.vivado.installDir` — legacy single path (kept for migration).
 *  3. `'vivado'`                  — relies on PATH
 */
export function getVivadoLauncher(
  config: vscode.WorkspaceConfiguration,
  preferredVersion?: string
): VivadoLauncher {
  const installDirs = config.get<string[]>('vivado.installDirs', []);
  if (installDirs.length > 0) {
    const resolved = resolveVivadoVersions(installDirs);
    const chosen = preferredVersion
      ? resolved.find((r) => r.version === preferredVersion)
      : [...resolved].sort((a, b) => compareVersions(b.version, a.version))[0];
    if (chosen) {
      return chosen.launcher;
    }
  }

  const installDir = config.get<string>('vivado.installDir', '').trim();
  if (installDir) {
    const found = findVivadoInInstallDir(installDir);
    if (found) {
      return found;
    }
  }

  return { exe: 'vivado', prefixArgs: [] };
}
