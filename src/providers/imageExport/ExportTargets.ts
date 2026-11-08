import type * as vscode from 'vscode';

export type ExportEditorKind = 'systemDiagram' | 'ipCore';

/**
 * The open diagram editors that can export an image, so the Export Diagram as Image command can
 * reach the active one: a custom editor's webview is not available through the VS Code API.
 */
export class ExportTargets {
  private readonly panels = new Map<vscode.WebviewPanel, ExportEditorKind>();

  /** Tracks `panel` until the returned disposable is disposed (when the panel is). */
  register(panel: vscode.WebviewPanel, kind: ExportEditorKind): vscode.Disposable {
    this.panels.set(panel, kind);
    return { dispose: () => void this.panels.delete(panel) };
  }

  /** Asks the active editor's webview to open its export options; false when none is active. */
  openActive(): boolean {
    for (const panel of this.panels.keys()) {
      if (panel.active) {
        void panel.webview.postMessage({ type: 'openExport' });
        return true;
      }
    }
    return false;
  }
}
