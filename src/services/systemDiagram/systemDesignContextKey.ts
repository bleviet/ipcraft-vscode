import * as vscode from 'vscode';
import { isSystemDesignScript } from './systemDesignDetection';

export const SYSTEM_DESIGN_CONTEXT_KEY = 'ipcraft.isSystemDesignScript';
/** Typing re-checks the active document once the edits pause this long. */
export const DETECT_DEBOUNCE_MS = 300;

const CANDIDATE_FILE = /\.(?:tcl|qsys)$/;

/**
 * Keeps `ipcraft.isSystemDesignScript` in sync with the active text editor so
 * the toggle keybinding and menus only appear on block design scripts. Only
 * Tcl and `.qsys` files are read, and the key is set only when it changes.
 */
export function registerSystemDesignContextKey(context: vscode.ExtensionContext): void {
  let current: boolean | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = (editor: vscode.TextEditor | undefined) => {
    clearTimeout(timer);
    const document = editor?.document;
    const isSystemDesign =
      !!document &&
      CANDIDATE_FILE.test(document.fileName) &&
      isSystemDesignScript(document.fileName, document.getText());
    if (isSystemDesign !== current) {
      current = isSystemDesign;
      void vscode.commands.executeCommand('setContext', SYSTEM_DESIGN_CONTEXT_KEY, isSystemDesign);
    }
  };
  update(vscode.window.activeTextEditor);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(update),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const active = vscode.window.activeTextEditor;
      if (active?.document === event.document && CANDIDATE_FILE.test(active.document.fileName)) {
        clearTimeout(timer);
        timer = setTimeout(() => update(vscode.window.activeTextEditor), DETECT_DEBOUNCE_MS);
      }
    }),
    { dispose: () => clearTimeout(timer) }
  );
}
