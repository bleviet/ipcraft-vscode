import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';
import { detectQuartusVersionAt } from './detectQuartusVersion';
import { compareVersions } from './toolchainVersions';

// quartus_sh / quartus live in bin64 (Windows) or bin / linux64 (Linux).
// qsys-edit lives in sopc_builder/bin on both platforms (verified against
// native Windows installs and the cvsoc/quartus Docker image).
const WIN_SUBDIRS = [
  'quartus/bin64',
  'quartus/sopc_builder/bin',
  'quartus/bin',
  'bin64',
  'bin',
  '',
];
const LINUX_SUBDIRS = ['quartus/bin', 'quartus/sopc_builder/bin', 'quartus/linux64', 'bin', ''];

/**
 * Searches well-known subdirectories of `installDir` for `toolName`.
 * Returns the absolute path of the first match, or `null` if not found.
 *
 * Candidate layout (tried in order):
 *   Windows  — <installDir>/quartus/bin64/<tool>.exe        (quartus, quartus_sh)
 *              <installDir>/quartus/sopc_builder/bin/<tool>.exe  (qsys-edit)
 *              <installDir>/quartus/bin/<tool>.exe
 *              <installDir>/bin64/<tool>.exe
 *              <installDir>/bin/<tool>.exe
 *              <installDir>/<tool>.exe
 *   Linux    — <installDir>/quartus/bin/<tool>              (quartus, quartus_sh)
 *              <installDir>/quartus/sopc_builder/bin/<tool> (qsys-edit)
 *              <installDir>/quartus/linux64/<tool>          (cvsoc container)
 *              <installDir>/bin/<tool>
 *              <installDir>/<tool>
 */
export function findInInstallDir(toolName: string, installDir: string): string | null {
  const isWindows = process.platform === 'win32';
  const exe = isWindows ? toolName + '.exe' : toolName;
  const subdirs = isWindows ? WIN_SUBDIRS : LINUX_SUBDIRS;

  for (const sub of subdirs) {
    const candidate = sub ? path.join(installDir, sub, exe) : path.join(installDir, exe);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export interface ResolvedQuartusVersion {
  version: string;
  installDir: string;
}

/**
 * Resolves each entry in `installDirs` to its version label (probed via
 * `quartus_sh --version`, falling back to the directory's own folder name).
 * Entries where `quartus_sh` can't be found are skipped — unlike Vivado,
 * each Quartus installDirs entry must already be the exact version directory.
 */
export function resolveQuartusVersions(installDirs: string[]): ResolvedQuartusVersion[] {
  const results: ResolvedQuartusVersion[] = [];
  for (const dir of installDirs) {
    const exe = findInInstallDir('quartus_sh', dir);
    if (!exe) {
      continue;
    }
    const probed = detectQuartusVersionAt(exe);
    results.push({ version: probed ?? path.basename(dir), installDir: dir });
  }
  return results;
}

/**
 * Returns the executable path for a Quartus tool.
 *
 * Resolution order:
 *  1. `ipcraft.quartus.installDirs` — multi-version array; picks `preferredVersion`
 *     if given and configured, else the latest configured version.
 *  2. `ipcraft.quartus.installDir` — legacy single path (kept for migration).
 *  3. bare tool name — relies on PATH
 */
export function getQuartusTool(
  config: vscode.WorkspaceConfiguration,
  toolName: string,
  preferredVersion?: string
): string {
  const installDirs = config.get<string[]>('quartus.installDirs', []);
  if (installDirs.length > 0) {
    const resolved = resolveQuartusVersions(installDirs);
    const chosen = preferredVersion
      ? resolved.find((r) => r.version === preferredVersion)
      : [...resolved].sort((a, b) => compareVersions(b.version, a.version))[0];
    if (chosen) {
      const found = findInInstallDir(toolName, chosen.installDir);
      if (found) {
        return found;
      }
    }
  }

  const installDir = config.get<string>('quartus.installDir', '').trim();
  if (installDir) {
    return findInInstallDir(toolName, installDir) ?? toolName;
  }
  return toolName;
}
