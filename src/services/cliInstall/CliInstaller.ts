/**
 * Issue #206: makes the `ipcraft` CLI usable from a terminal after installing the
 * extension, without sudo/admin rights and without a separate Node.js install.
 *
 * Two independent mechanisms, both driven by the pure builders in launcherScripts.ts:
 *
 * 1. `refreshLauncher` (called on every activation) writes a launcher into the
 *    extension's own `globalStorageUri` and prepends its directory to
 *    `context.environmentVariableCollection`'s PATH. This alone makes `ipcraft` work in
 *    every *new* VS Code integrated terminal, with zero user action — the launcher
 *    always points at the currently active `process.execPath` + `dist/cli.js`, so it is
 *    never stale after an extension update.
 * 2. `installCommand`/`uninstallCommand` (the "IPCraft: Install/Uninstall 'ipcraft'
 *    Command in PATH" commands) are for *external* terminals and CI shells, which never
 *    see `environmentVariableCollection`. They write a small, stable shim — pointing at
 *    the same globalStorage launcher — into a user-writable bin directory
 *    (`~/.local/bin` on Linux/macOS, `%LOCALAPPDATA%\Programs\ipcraft` on Windows) and,
 *    if that directory is not already on PATH, offer to add it (a shell profile block on
 *    POSIX, the `HKCU` user PATH on Windows).
 */

import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Logger } from '../../utils/Logger';
import {
  posixLauncher,
  windowsLauncher,
  posixShim,
  windowsShim,
  isOwnShim,
  userBinDir,
  isDirOnPath,
  shellProfileFor,
  pathExprForProfile,
  pathExportLine,
  addPathBlock,
  removePathBlock,
} from './launcherScripts';
import { addToWindowsUserPath, removeFromWindowsUserPath } from './windowsUserPath';

const logger = new Logger('CliInstaller');

const LAUNCHER_FILE_NAME = 'ipcraft';
const LAUNCHER_FILE_NAME_WIN = 'ipcraft.cmd';

async function readFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The stable bin directory inside this extension's globalStorage that the PATH entry points at. */
function getBinDir(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, 'bin');
}

/**
 * The stable, cross-update POSIX launcher path. `installCommand`'s shim always forwards
 * here, and this is also what `environmentVariableCollection` puts on PATH for
 * integrated terminals — so it is the one path an e2e test needs to find and run.
 */
export function getLauncherPath(context: vscode.ExtensionContext): string {
  return path.join(getBinDir(context), LAUNCHER_FILE_NAME);
}

/**
 * Rewrites the globalStorage launcher to point at the current `process.execPath` +
 * `dist/cli.js`, and prepends its directory to the integrated terminal's PATH. Call on
 * every activation (fire-and-forget); never throws — a failure here must never block
 * activation, it just means `ipcraft` is unavailable this session.
 */
export async function refreshLauncher(context: vscode.ExtensionContext): Promise<void> {
  try {
    const binDir = getBinDir(context);
    await fs.mkdir(binDir, { recursive: true });

    const execPath = process.execPath;
    const cliJsPath = path.join(context.extensionPath, 'dist', 'cli.js');

    const posixPath = path.join(binDir, LAUNCHER_FILE_NAME);
    await fs.writeFile(posixPath, posixLauncher(execPath, cliJsPath), 'utf8');
    await fs.chmod(posixPath, 0o755);

    const windowsPath = path.join(binDir, LAUNCHER_FILE_NAME_WIN);
    await fs.writeFile(windowsPath, windowsLauncher(execPath, cliJsPath), 'utf8');

    context.environmentVariableCollection.prepend('PATH', binDir + path.delimiter);
    context.environmentVariableCollection.description = "Adds IPCraft's ipcraft CLI to PATH";
  } catch (error) {
    logger.error(`Failed to refresh the ipcraft launcher: ${describeError(error)}`);
  }
}

/** Shows the PATH line the user can copy into whatever shell config they use. */
async function showPathInstructions(binDir: string, homedir: string): Promise<void> {
  const exportLine = pathExportLine(pathExprForProfile(binDir, homedir));
  const copyAction = 'Copy';
  const choice = await vscode.window.showInformationMessage(
    `Add ${binDir} to your PATH: ${exportLine}`,
    copyAction
  );
  if (choice === copyAction) {
    await vscode.env.clipboard.writeText(exportLine);
  }
}

/** POSIX branch of "the bin dir isn't on PATH yet": offer to edit a known shell profile, else show a hint. */
async function offerPosixPathSetup(binDir: string, homedir: string): Promise<void> {
  const profilePath = shellProfileFor(process.platform, process.env.SHELL, homedir);
  if (!profilePath) {
    await showPathInstructions(binDir, homedir);
    return;
  }

  const addAction = 'Add';
  const instructionsAction = 'Show instructions';
  const choice = await vscode.window.showInformationMessage(
    `Add ${binDir} to PATH in ${profilePath}?`,
    { modal: true },
    addAction,
    instructionsAction
  );

  if (choice === addAction) {
    const existing = (await readFileIfExists(profilePath)) ?? '';
    const updated = addPathBlock(existing, pathExprForProfile(binDir, homedir));
    await fs.writeFile(profilePath, updated, 'utf8');
    void vscode.window.showInformationMessage(
      `Installed 'ipcraft' to ${binDir} and updated ${profilePath}. Open a new terminal to use it.`
    );
    return;
  }

  if (choice === instructionsAction) {
    await showPathInstructions(binDir, homedir);
    return;
  }
  // Dismissed: still confirm the shim itself was installed.
  void vscode.window.showInformationMessage(`Installed 'ipcraft' to ${binDir}.`);
}

/** Windows branch of "the bin dir isn't on PATH yet": update the user PATH directly (no admin rights required). */
async function offerWindowsPathSetup(binDir: string): Promise<void> {
  try {
    await addToWindowsUserPath(binDir);
    void vscode.window.showInformationMessage(
      `Installed 'ipcraft' to ${binDir} and added it to your PATH. Open a new terminal to use it.`
    );
  } catch (error) {
    logger.error(`Failed to update the Windows user PATH: ${describeError(error)}`);
    void vscode.window.showErrorMessage(
      `Installed 'ipcraft' to ${binDir}, but could not update your PATH automatically. ` +
        `Add ${binDir} to your PATH via "Edit environment variables for your account".`
    );
  }
}

/**
 * `fpga-ip-core.installCli`: writes a shim into the user's no-sudo bin directory and, if
 * needed, offers to put that directory on PATH for external terminals/CI shells.
 */
export async function installCommand(context: vscode.ExtensionContext): Promise<void> {
  await refreshLauncher(context);
  const launcherPath = getLauncherPath(context);
  const homedir = os.homedir();
  const binDir = userBinDir(process.platform, process.env, homedir);
  const isWindows = process.platform === 'win32';
  const shimName = isWindows ? LAUNCHER_FILE_NAME_WIN : LAUNCHER_FILE_NAME;
  const shimPath = path.join(binDir, shimName);

  try {
    await fs.mkdir(binDir, { recursive: true });
  } catch (error) {
    logger.error(`Failed to create ${binDir}: ${describeError(error)}`);
    void vscode.window.showErrorMessage(`Could not create ${binDir}: ${describeError(error)}`);
    return;
  }

  const existing = await readFileIfExists(shimPath);
  if (existing !== undefined && !isOwnShim(existing)) {
    const message =
      `An existing '${shimName}' was found at ${shimPath} that IPCraft did not create. ` +
      `Remove it, then run "IPCraft: Install 'ipcraft' Command in PATH" again.`;
    logger.warn(message);
    void vscode.window.showErrorMessage(message);
    return;
  }

  const shimContent = isWindows ? windowsShim(launcherPath) : posixShim(launcherPath);
  await fs.writeFile(shimPath, shimContent, 'utf8');
  if (!isWindows) {
    await fs.chmod(shimPath, 0o755);
  }

  if (isDirOnPath(binDir, process.env.PATH, process.platform)) {
    void vscode.window.showInformationMessage(
      `Installed 'ipcraft' to ${binDir}. Open a new terminal to use it.`
    );
    return;
  }

  if (isWindows) {
    await offerWindowsPathSetup(binDir);
  } else {
    await offerPosixPathSetup(binDir, homedir);
  }
}

/**
 * `fpga-ip-core.uninstallCli`: removes only the shim/PATH entry IPCraft created. Leaves
 * anything it did not create (a foreign `ipcraft` on PATH, an unrelated profile) alone.
 */
export async function uninstallCommand(): Promise<void> {
  const homedir = os.homedir();
  const binDir = userBinDir(process.platform, process.env, homedir);
  const isWindows = process.platform === 'win32';
  const shimName = isWindows ? LAUNCHER_FILE_NAME_WIN : LAUNCHER_FILE_NAME;
  const shimPath = path.join(binDir, shimName);

  const existing = await readFileIfExists(shimPath);
  if (existing !== undefined) {
    if (isOwnShim(existing)) {
      await fs.rm(shimPath, { force: true });
    } else {
      logger.warn(`Skipped removing ${shimPath}: not an IPCraft shim.`);
    }
  }

  if (isWindows) {
    try {
      await removeFromWindowsUserPath(binDir);
    } catch (error) {
      logger.error(`Failed to update the Windows user PATH: ${describeError(error)}`);
    }
  } else {
    const profilePath = shellProfileFor(process.platform, process.env.SHELL, homedir);
    if (profilePath) {
      const content = await readFileIfExists(profilePath);
      if (content !== undefined) {
        const updated = removePathBlock(content);
        if (updated !== content) {
          await fs.writeFile(profilePath, updated, 'utf8');
        }
      }
    }
  }

  void vscode.window.showInformationMessage(`Uninstalled 'ipcraft' from ${binDir}.`);
}
