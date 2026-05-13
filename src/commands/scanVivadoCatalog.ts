import * as vscode from 'vscode';
import { VivadoCatalogScanner } from '../services/VivadoCatalogScanner';

export async function scanVivadoCatalogCommand(): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Scanning Vivado IP catalog...' },
    async () => {
      const scanner = new VivadoCatalogScanner();
      const result = await scanner.scan();
      void vscode.window.showInformationMessage(
        `Found ${result.count} IPs. Catalog saved to ${result.catalogPath}`
      );
    }
  );
}
