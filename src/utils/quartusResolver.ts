import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';

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

/**
 * Returns the executable path for a Quartus tool.
 * Looks in `ipcraft.quartus.installDir` first; falls back to bare tool name
 * (PATH lookup) when installDir is empty or the tool is not found within it.
 */
export function getQuartusTool(config: vscode.WorkspaceConfiguration, toolName: string): string {
  const installDir = config.get<string>('quartus.installDir', '').trim();
  if (installDir) {
    return findInInstallDir(toolName, installDir) ?? toolName;
  }
  return toolName;
}
