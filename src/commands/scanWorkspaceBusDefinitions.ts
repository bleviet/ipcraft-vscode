import * as vscode from 'vscode';
import { getWorkspaceBusDefinitionScanner } from '../services/WorkspaceBusDefinitionScanner';

/**
 * Command handler for "Scan Workspace Bus Definitions". Forces a re-scan of
 * workspace folders for standalone bus definition files — YAML and IP-XACT
 * bus/abstraction definition XML (e.g. from Vivado's IP Packager) — refreshes
 * the Control Center tree, and notifies open IP core editors so their
 * Inspector picks up the updated bus library.
 *
 * The `onDidScan` event from the scanner triggers `IpCoreEditorProvider` to
 * clear its import-resolver cache and force-resync any open webview, so
 * discovered workspace bus definitions appear as known interfaces without
 * needing to re-open the editor.
 */
export async function scanWorkspaceBusDefinitionsCommand(): Promise<void> {
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Scanning workspace for bus definitions...',
    },
    async () => {
      const scanner = getWorkspaceBusDefinitionScanner();
      try {
        scanner.clearCache();
        const result = await scanner.scan(true);
        if (result.count === 0) {
          void vscode.window.showInformationMessage(
            'No bus definition files found in the workspace. ' +
              'Bus definitions are either .yml/.yaml files with a top-level key containing a `ports` array ' +
              '(excluding .ip.yml and .mm.yml), or IP-XACT busDefinition/abstractionDefinition .xml file pairs.'
          );
        } else {
          void vscode.window.showInformationMessage(
            `Found ${result.count} workspace bus definition(s) in ${result.files.length} file(s). They are now available as known interfaces in the Inspector.`
          );
        }
      } catch (error) {
        void vscode.window.showErrorMessage(
          `Workspace bus definition scan failed: ${(error as Error).message}`
        );
      }
    }
  );
}
