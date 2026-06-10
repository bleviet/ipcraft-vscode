import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';
import { handleError } from '../utils/ErrorHandler';

/**
 * Service responsible for managing document read/write operations
 */
export class DocumentManager {
  private readonly logger = new Logger('DocumentManager');

  /** Per-document chain of pending edits, keyed by document URI. */
  private readonly updateQueues = new Map<string, Promise<unknown>>();

  /**
   * Get the text content of a document
   */
  getText(document: vscode.TextDocument): string {
    return document.getText();
  }

  /**
   * Update a text document with new content.
   *
   * Updates to the same document are serialized: the replace range must be
   * computed against the document state at the time the edit is applied,
   * otherwise an overlapping earlier edit would make the range stale and the
   * replace would leave a tail of the previous content behind.
   *
   * @param document The document to update
   * @param text The new content
   * @returns Promise that resolves when the edit is applied
   */
  updateDocument(document: vscode.TextDocument, text: string): Promise<boolean> {
    const key = document.uri.toString();
    const previous = this.updateQueues.get(key) ?? Promise.resolve();
    const task = previous.then(() => this.performUpdate(document, text));
    this.updateQueues.set(
      key,
      task.then(
        () => undefined,
        () => undefined
      )
    );
    return task;
  }

  private async performUpdate(document: vscode.TextDocument, text: string): Promise<boolean> {
    if (document.getText() === text) {
      return true;
    }
    try {
      const edit = new vscode.WorkspaceEdit();
      const lastLine = document.lineAt(Math.max(0, document.lineCount - 1));

      edit.replace(
        document.uri,
        new vscode.Range(0, 0, lastLine.lineNumber, lastLine.text.length),
        text
      );

      const success = await vscode.workspace.applyEdit(edit);

      if (success) {
        this.logger.debug('Document updated successfully');
      } else {
        this.logger.warn('Document update failed');
      }

      return success;
    } catch (error) {
      handleError(error, 'DocumentManager.performUpdate');
      return false;
    }
  }

  /**
   * Save a document
   * @param document The document to save
   */
  async saveDocument(document: vscode.TextDocument): Promise<boolean> {
    try {
      const success = await document.save();
      this.logger.debug(`Document ${success ? 'saved' : 'save failed'}`);
      return success;
    } catch (error) {
      handleError(error, 'DocumentManager.saveDocument');
      return false;
    }
  }

  /**
   * Get the relative path of a document
   */
  getRelativePath(uri: vscode.Uri): string {
    return vscode.workspace.asRelativePath(uri, false);
  }
}
