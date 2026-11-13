import * as vscode from 'vscode';

/**
 * `IPCraft: Compare System Design with...`: picks what to compare the active system diagram with.
 * Returns whether a system diagram was active.
 */
export function compareSystemDesignCommand(compareActive: () => boolean): () => boolean {
  return () => {
    const active = compareActive();
    if (!active) {
      void vscode.window.showInformationMessage(
        'Open a system design as a diagram to compare it with another revision.'
      );
    }
    return active;
  };
}
