/**
 * Windows user PATH updates for issue #206, via PowerShell's
 * `[Environment]::[Get|Set]EnvironmentVariable(..., 'User')`.
 *
 * This targets `HKCU\Environment`, which needs no admin rights (unlike the machine-wide
 * PATH). `setx` is deliberately avoided: it silently truncates PATH values longer than
 * 1024 characters, which is easy to exceed on a real machine's PATH.
 *
 * Only string-building (`addWindowsPathEntry`/`removeWindowsPathEntry`, tested in
 * launcherScripts.test.ts) is unit tested here in isolation; actually invoking
 * PowerShell can only be exercised on a real Windows machine.
 */

import { execFile } from 'child_process';
import {
  addWindowsPathEntry,
  removeWindowsPathEntry,
  escapePowerShellSingleQuoted,
} from './launcherScripts';

const GET_USER_PATH_COMMAND = `[Environment]::GetEnvironmentVariable('Path','User')`;

function setUserPathCommand(value: string): string {
  return `[Environment]::SetEnvironmentVariable('Path', '${escapePowerShellSingleQuoted(value)}', 'User')`;
}

function runPowerShell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(stdout.toString());
      }
    );
  });
}

/** Adds `dir` to the current user's PATH, unless it is already present. */
export async function addToWindowsUserPath(dir: string): Promise<void> {
  const current = await runPowerShell(GET_USER_PATH_COMMAND);
  await runPowerShell(setUserPathCommand(addWindowsPathEntry(current, dir)));
}

/** Removes `dir` from the current user's PATH. */
export async function removeFromWindowsUserPath(dir: string): Promise<void> {
  const current = await runPowerShell(GET_USER_PATH_COMMAND);
  await runPowerShell(setUserPathCommand(removeWindowsPathEntry(current, dir)));
}
