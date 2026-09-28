/**
 * VS Code commands for issue #206: putting the `ipcraft` CLI on PATH for external
 * terminals/CI shells. See src/services/cliInstall/CliInstaller.ts for the logic; this
 * module only wires the two commands and reports unexpected failures to the user.
 *
 * These commands only touch user-owned files (the extension's own globalStorage, a
 * user bin directory, a shell profile, or the Windows user PATH) — never the workspace —
 * so, unlike most generation/build commands, they do not require workspace trust.
 */

import * as vscode from 'vscode';
import { safeRegisterCommand } from '../utils/vscodeHelpers';
import { installCommand, uninstallCommand } from '../services/cliInstall/CliInstaller';
import { handleErrorWithUserNotification } from '../utils/ErrorHandler';

export function registerCliInstallCommands(context: vscode.ExtensionContext): void {
  safeRegisterCommand(context, 'fpga-ip-core.installCli', async () => {
    try {
      await installCommand(context);
    } catch (error) {
      await handleErrorWithUserNotification(
        error,
        'CliInstallCommands.installCli',
        "Failed to install the 'ipcraft' command."
      );
    }
  });

  safeRegisterCommand(context, 'fpga-ip-core.uninstallCli', async () => {
    try {
      await uninstallCommand();
    } catch (error) {
      await handleErrorWithUserNotification(
        error,
        'CliInstallCommands.uninstallCli',
        "Failed to uninstall the 'ipcraft' command."
      );
    }
  });
}
