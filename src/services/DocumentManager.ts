import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';
import { ErrorHandler } from '../utils/ErrorHandler';

/**
 * Service responsible for managing document read/write operations
 */
export class DocumentManager {
  private readonly logger = new Logger('DocumentManager');

  /**
   * Get the text content of a document
   */
  getText(document: vscode.TextDocument): string {
    return document.getText();
  }

  /**
   * Update a text document with new content
   * @param document The document to update
   * @param text The new content
   * @returns Promise that resolves when the edit is applied
   */
  async updateDocument(document: vscode.TextDocument, text: string): Promise<boolean> {
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
      ErrorHandler.handle(error, 'DocumentManager.updateDocument');
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
      ErrorHandler.handle(error, 'DocumentManager.saveDocument');
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
