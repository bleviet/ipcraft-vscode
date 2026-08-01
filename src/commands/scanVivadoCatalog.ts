import * as vscode from 'vscode';
import { VivadoCatalogScanner } from '../services/VivadoCatalogScanner';
import { resolveToolchainVersionForResource } from '../services/toolchains/resolveToolchainVersion';
import { CONFIG_KEY_IPCRAFT } from '../utils/configKeys';
import { requireWorkspaceTrust } from '../utils/workspaceTrust';

export async function scanVivadoCatalogCommand(): Promise<void> {
  if (!(await requireWorkspaceTrust())) {
    return;
  }

  const resourceUri = vscode.window.activeTextEditor?.document.uri;
  const cfg = vscode.workspace.getConfiguration(CONFIG_KEY_IPCRAFT, resourceUri);
  const choice = await resolveToolchainVersionForResource(cfg, 'vivado');
  if (choice === undefined) {
    return;
  }

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Scanning Vivado IP catalog...' },
    async () => {
      const scanner = new VivadoCatalogScanner();
      const result = await scanner.scan(choice, cfg, resourceUri);
      void vscode.window.showInformationMessage(
        `Found ${result.count} IPs. Catalog saved to ${result.catalogPath}`
      );
    }
  );
}
