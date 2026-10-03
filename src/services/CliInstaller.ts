import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { CLI_SHIM_MARKER, cliScriptName, renderCliLauncher, renderCliShim } from './CliShim';

async function readIfExists(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/** Write via a temp file and rename so concurrent windows never see a partial script. */
async function writeAtomic(target: string, contents: string): Promise<void> {
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(tmp, contents, { mode: 0o755 });
    await fs.chmod(tmp, 0o755);
    await fs.rename(tmp, target);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

/** Write the launcher that runs `<extensionPath>/dist/cli.js` on VS Code's runtime. */
export async function writeCliLauncher(
  binDir: string,
  execPath: string,
  extensionPath: string,
  platform: NodeJS.Platform,
  isElectron: boolean
): Promise<string> {
  await fs.mkdir(binDir, { recursive: true });
  const launcherPath = path.join(binDir, cliScriptName(platform));
  const cliPath = path.join(extensionPath, 'dist', 'cli.js');
  await writeAtomic(launcherPath, renderCliLauncher(platform, execPath, cliPath, isElectron));
  return launcherPath;
}

export async function installCliShim(
  shimDir: string,
  launcherPath: string,
  platform: NodeJS.Platform
): Promise<string> {
  await fs.mkdir(shimDir, { recursive: true });
  const shimPath = path.join(shimDir, cliScriptName(platform));
  const existing = await readIfExists(shimPath);
  if (existing !== undefined && !existing.includes(CLI_SHIM_MARKER)) {
    throw new Error(
      `Refusing to overwrite foreign file ${shimPath}; it was not created by IPCraft`
    );
  }
  await writeAtomic(shimPath, renderCliShim(platform, launcherPath));
  return shimPath;
}

export async function uninstallCliShim(
  shimDir: string,
  platform: NodeJS.Platform
): Promise<boolean> {
  const shimPath = path.join(shimDir, cliScriptName(platform));
  const existing = await readIfExists(shimPath);
  if (!existing?.includes(CLI_SHIM_MARKER)) {
    return false;
  }
  await fs.rm(shimPath);
  if (platform === 'win32' && (await fs.readdir(shimDir)).length === 0) {
    await fs.rmdir(shimDir);
  }
  return true;
}

function runPowerShell(command: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { env, windowsHide: true },
      (error, stdout) => (error ? reject(error) : resolve(stdout))
    );
  });
}

/** Read the user PATH without expanding %VAR% entries. */
export async function readWindowsUserPath(): Promise<string> {
  const out = await runPowerShell(
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ' +
      "(Get-Item 'HKCU:\\Environment').GetValue('Path', '', 'DoNotExpandEnvironmentNames')"
  );
  return out.replace(/\r?\n$/, '');
}

/** Write the user PATH (value passed via env var, never setx) and broadcast the change. */
export async function writeWindowsUserPath(value: string): Promise<void> {
  await runPowerShell(
    "Set-ItemProperty -Path 'HKCU:\\Environment' -Name Path -Value $env:IPCRAFT_USER_PATH -Type ExpandString; " +
      "[Environment]::SetEnvironmentVariable('IPCRAFT_PATH_REFRESH','1','User'); " +
      "[Environment]::SetEnvironmentVariable('IPCRAFT_PATH_REFRESH',$null,'User')",
    { ...process.env, IPCRAFT_USER_PATH: value }
  );
}
