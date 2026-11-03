import * as vscode from 'vscode';
import { isSystemDesignScript } from './systemDesignDetection';

export const SYSTEM_DESIGN_CONTEXT_KEY = 'ipcraft.isSystemDesignScript';

function updateContextKey(editor: vscode.TextEditor | undefined): void {
  const isSystemDesign = editor
    ? isSystemDesignScript(editor.document.fileName, editor.document.getText())
    : false;
  void vscode.commands.executeCommand('setContext', SYSTEM_DESIGN_CONTEXT_KEY, isSystemDesign);
}

/**
 * Keeps `ipcraft.isSystemDesignScript` in sync with the active text editor so
 * the toggle keybinding and menus only appear on block design scripts.
 */
export function registerSystemDesignContextKey(context: vscode.ExtensionContext): void {
  updateContextKey(vscode.window.activeTextEditor);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateContextKey),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const active = vscode.window.activeTextEditor;
      if (active?.document === event.document) {
        updateContextKey(active);
      }
    })
  );
}
