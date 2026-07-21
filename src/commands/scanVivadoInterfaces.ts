import * as vscode from 'vscode';
import { VivadoInterfaceScanner } from '../services/VivadoInterfaceScanner';
import { handleErrorWithUserNotification } from '../utils/ErrorHandler';
import { requireWorkspaceTrust } from '../utils/workspaceTrust';

export async function scanVivadoInterfacesCommand(): Promise<void> {
  if (!(await requireWorkspaceTrust())) {
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Scanning Vivado interface catalog...',
    },
    async () => {
      const scanner = new VivadoInterfaceScanner();
      try {
        const result = await scanner.scan();
        void vscode.window.showInformationMessage(
          `Found ${result.count} interfaces (Vivado ${result.version}). Cached to ${result.cacheDir}`
        );
      } catch (error) {
        void handleErrorWithUserNotification(
          error,
          'scanVivadoInterfaces',
          `Vivado interface scan failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  );
}
