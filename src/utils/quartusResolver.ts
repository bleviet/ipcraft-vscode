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
 * Searches well-known subdirectories of `installDir` for `toolName` and
 * returns the absolute path of the first match.  Falls back to the bare tool
 * name (PATH lookup) when nothing is found.
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
export function resolveQuartusTool(toolName: string, installDir: string): string {
  const isWindows = process.platform === 'win32';
  const exe = isWindows ? toolName + '.exe' : toolName;
  const subdirs = isWindows ? WIN_SUBDIRS : LINUX_SUBDIRS;

  for (const sub of subdirs) {
    const candidate = sub ? path.join(installDir, sub, exe) : path.join(installDir, exe);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return toolName;
}

/**
 * Returns the resolved executable path for a Quartus tool.
 *
 * Priority:
 *   1. `ipcraft.quartus.installDir` — auto-resolves all three tool paths from
 *      a single top-level Quartus installation directory.
 *   2. `legacyKey` (e.g. `quartus.shellPath`) — individual path override kept
 *      for backward compatibility.
 *   3. Bare `toolName` — relies on the system PATH.
 */
export function getQuartusTool(
  config: vscode.WorkspaceConfiguration,
  toolName: string,
  legacyKey: string
): string {
  const installDir = config.get<string>('quartus.installDir', '').trim();
  if (installDir) {
    return resolveQuartusTool(toolName, installDir);
  }
  const legacy = config.get<string>(legacyKey, '').trim();
  return legacy || toolName;
}
