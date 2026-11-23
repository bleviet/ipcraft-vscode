import * as vscode from 'vscode';
import { applyPathEdits, type PathEdit } from '../../yamledit';

/**
 * Applies `edits` to `document` as ONE format-preserving whole-text replacement (the same host
 * write pattern as the spec upgrade command, which keeps open custom editors in sync through the
 * document change). Returns false when the edits change nothing; throws if the editor rejects it.
 */
export async function applyDocumentPathEdits(
  document: vscode.TextDocument,
  edits: PathEdit[]
): Promise<boolean> {
  const text = document.getText();
  const newText = applyPathEdits(text, edits);
  if (newText === text) {
    return false;
  }
  const lastLine = document.lineAt(Math.max(0, document.lineCount - 1));
  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    document.uri,
    new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length),
    newText
  );
  if (!(await vscode.workspace.applyEdit(edit))) {
    throw new Error(`The editor rejected the edit of ${document.uri.fsPath}.`);
  }
  return true;
}

export async function saveDocument(document: vscode.TextDocument): Promise<void> {
  if (!(await document.save())) {
    throw new Error(`${document.uri.fsPath} could not be saved.`);
  }
}
