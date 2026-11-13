import * as vscode from 'vscode';

/** `IPCraft: Compare System Design with...`: picks what to compare the active system diagram with. */
export function compareSystemDesignCommand(compareActive: () => boolean): () => void {
  return () => {
    if (!compareActive()) {
      void vscode.window.showInformationMessage(
        'Open a system design as a diagram to compare it with another revision.'
      );
    }
  };
}
