import * as vscode from 'vscode';

/**
 * `IPCraft: Attach Resource Report...`: attaches report files to the active system diagram.
 * Returns whether a system diagram was active.
 */
export function attachResourceReportCommand(attachActive: () => boolean): () => boolean {
  return () => {
    const active = attachActive();
    if (!active) {
      void vscode.window.showInformationMessage(
        'Open a system design as a diagram to attach a resource report to it.'
      );
    }
    return active;
  };
}
