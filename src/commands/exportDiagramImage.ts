import * as vscode from 'vscode';
import type { ExportTargets } from '../providers/imageExport/ExportTargets';

/** `IPCraft: Export Diagram as Image`: opens the export options of the active diagram editor. */
export function exportDiagramImageCommand(targets: ExportTargets): () => void {
  return () => {
    if (!targets.openActive()) {
      void vscode.window.showInformationMessage(
        'Open an IP core or a system design in its visual editor to export a diagram image.'
      );
    }
  };
}
