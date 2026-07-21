import * as vscode from 'vscode';
import { VivadoCatalogScanner } from '../services/VivadoCatalogScanner';
import { requireWorkspaceTrust } from '../utils/workspaceTrust';

export async function scanVivadoCatalogCommand(): Promise<void> {
  if (!(await requireWorkspaceTrust())) {
    return;
  }

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
