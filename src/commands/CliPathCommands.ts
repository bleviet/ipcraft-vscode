import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { Logger } from '../utils/Logger';
import { safeRegisterCommand } from '../utils/vscodeHelpers';
import {
  addPathEntry,
  externalShimDir,
  isDirOnPath,
  needsRunAsNodeSwitch,
  removePathEntry,
} from '../services/CliShim';
import {
  installCliShim,
  readWindowsUserPath,
  uninstallCliShim,
  writeCliLauncher,
  writeWindowsUserPath,
} from '../services/CliInstaller';

const PROFILE_LINE = 'export PATH="$HOME/.local/bin:$PATH"';
const ADD_LABEL = 'Add to ~/.zprofile';
const COPY_LABEL = 'Copy Line';

function binDirOf(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, 'bin');
}

function writeLauncher(context: vscode.ExtensionContext): Promise<string> {
  return writeCliLauncher(
    binDirOf(context),
    process.execPath,
    context.extensionPath,
    process.platform,
    needsRunAsNodeSwitch(process.versions.electron)
  );
}

async function appendToZprofile(): Promise<void> {
  const profile = path.join(os.homedir(), '.zprofile');
  let existing = '';
  try {
    existing = await fs.readFile(profile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  if (!existing.includes(PROFILE_LINE)) {
    await fs.appendFile(profile, `\n# Added by IPCraft\n${PROFILE_LINE}\n`);
  }
  void vscode.window.showInformationMessage(
    'Added to ~/.zprofile. Open a new terminal to use ipcraft.'
  );
}

async function offerPathLine(dir: string): Promise<void> {
  const buttons = process.platform === 'darwin' ? [ADD_LABEL, COPY_LABEL] : [COPY_LABEL];
  const choice = await vscode.window.showWarningMessage(
    `Installed 'ipcraft' to ${dir}, which is not on your PATH. Add this line to your shell profile: ${PROFILE_LINE}`,
    ...buttons
  );
  if (choice === ADD_LABEL) {
    await appendToZprofile();
  } else if (choice === COPY_LABEL) {
    await vscode.env.clipboard.writeText(PROFILE_LINE);
  }
}

async function installCommand(context: vscode.ExtensionContext): Promise<void> {
  const platform = process.platform;
  const launcher = await writeLauncher(context);
  const dir = externalShimDir(platform, os.homedir(), process.env);
  const shimPath = await installCliShim(dir, launcher, platform);

  if (platform === 'win32') {
    const userPath = await readWindowsUserPath();
    if (!isDirOnPath(userPath, dir, platform)) {
      await writeWindowsUserPath(addPathEntry(userPath, dir, platform));
    }
    void vscode.window.showInformationMessage(
      `Installed 'ipcraft' to ${dir}. Open a new terminal to use it.`
    );
  } else if (isDirOnPath(process.env.PATH ?? '', dir, platform)) {
    void vscode.window.showInformationMessage(`Installed 'ipcraft' to ${shimPath}.`);
  } else {
    await offerPathLine(dir);
  }
}

async function uninstallCommand(): Promise<void> {
  const platform = process.platform;
  const dir = externalShimDir(platform, os.homedir(), process.env);
  const removed = await uninstallCliShim(dir, platform);
  let pathCleaned = false;
  if (platform === 'win32') {
    const userPath = await readWindowsUserPath();
    if (isDirOnPath(userPath, dir, platform)) {
      await writeWindowsUserPath(removePathEntry(userPath, dir, platform));
      pathCleaned = true;
    }
  }
  void vscode.window.showInformationMessage(
    removed || pathCleaned
      ? `Removed 'ipcraft' from ${dir}.`
      : `Nothing to remove: no IPCraft-installed 'ipcraft' command in ${dir}.`
  );
}

export function registerCliPathCommands(context: vscode.ExtensionContext, logger?: Logger): void {
  const log = logger ?? new Logger('CliPathCommands');

  // Fire-and-forget: keep the launcher current and expose it to integrated terminals.
  writeLauncher(context)
    .then(() => {
      context.environmentVariableCollection.prepend('PATH', binDirOf(context) + path.delimiter);
    })
    .catch((error: unknown) => {
      log.error(
        'Failed to refresh ipcraft CLI launcher',
        error instanceof Error ? error : new Error(String(error))
      );
    });

  const guarded = (task: () => Promise<void>) => async () => {
    try {
      await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('ipcraft CLI PATH command failed', error instanceof Error ? error : undefined);
      void vscode.window.showErrorMessage(message);
    }
  };

  safeRegisterCommand(
    context,
    'fpga-ip-core.installCliInPath',
    guarded(() => installCommand(context))
  );
  safeRegisterCommand(context, 'fpga-ip-core.uninstallCliFromPath', guarded(uninstallCommand));
}
