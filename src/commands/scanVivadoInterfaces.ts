import * as vscode from 'vscode';
import { VivadoInterfaceScanner } from '../services/VivadoInterfaceScanner';

export async function scanVivadoInterfacesCommand(): Promise<void> {
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
        void vscode.window.showErrorMessage(
          `Vivado interface scan failed: ${(error as Error).message}`
        );
      }
    }
  );
}
