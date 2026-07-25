import * as vscode from 'vscode';
import { isIpCoreFile } from './fileExtensions';

interface FindActiveIpCoreFileOptions {
  /**
   * When a non-IP text editor is focused, also check the active custom-editor
   * tab for an .ip.yml file instead of giving up immediately. The original
   * Build-command lookup did this; the original Generate-command lookup did
   * not (it bailed out and showed an error instead). Preserved as an explicit
   * flag rather than silently merging the two behaviors.
   */
  fallThroughOnNonIpEditor?: boolean;
}

/** Resolve the active .ip.yml file with no side effects (no notifications). */
export function findActiveIpCoreFile(
  options: FindActiveIpCoreFileOptions = {}
): vscode.Uri | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor) {
    if (isIpCoreFile(editor.document.fileName)) {
      return editor.document.uri;
    }
    if (!options.fallThroughOnNonIpEditor) {
      return undefined;
    }
  }

  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (activeTab?.input instanceof vscode.TabInputCustom) {
    const { uri } = activeTab.input;
    if (isIpCoreFile(uri.fsPath)) {
      return uri;
    }
  }

  return undefined;
}

/** Resolve the active .ip.yml file, showing an error message when none is found. */
export function getActiveIpCoreFile(): vscode.Uri | undefined {
  const editor = vscode.window.activeTextEditor;
  if (editor && !isIpCoreFile(editor.document.fileName)) {
    void vscode.window.showErrorMessage('Active file is not an IP core file (*.ip.yml).');
    return undefined;
  }

  const uri = findActiveIpCoreFile();
  if (!uri) {
    void vscode.window.showErrorMessage('No active IP core file. Please open a .ip.yml file.');
  }
  return uri;
}
