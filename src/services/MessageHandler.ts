import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';
import { YamlValidator } from './YamlValidator';
import { DocumentManager } from './DocumentManager';

/**
 * Message types that can be sent from the webview
 */
export interface WebviewMessage {
  type: string;
  [key: string]: unknown;
}

/**
 * Update message from webview
 */
export interface UpdateMessage extends WebviewMessage {
  type: 'update';
  text: string;
}

/**
 * Command message from webview
 */
export interface CommandMessage extends WebviewMessage {
  type: 'command';
  command: string;
}

/**
 * Service responsible for handling messages between extension and webview
 */
export class MessageHandler {
  private readonly logger = new Logger('MessageHandler');

  constructor(
    private readonly yamlValidator: YamlValidator,
    private readonly documentManager: DocumentManager
  ) {}

  /**
   * Handle a message received from the webview
   */
  async handleMessage(message: WebviewMessage, document: vscode.TextDocument): Promise<void> {
    this.logger.debug('Received message from webview', message.type);

    switch (message.type) {
      case 'update':
        await this.handleUpdate(message as UpdateMessage, document);
        break;
      case 'command':
        await this.handleCommand(message as CommandMessage, document);
        break;
      default:
        this.logger.warn('Unknown message type', message.type);
    }
  }

  /**
   * Handle update message from webview
   */
  private async handleUpdate(message: UpdateMessage, document: vscode.TextDocument): Promise<void> {
    await this.documentManager.updateDocument(document, message.text);
  }

  /**
   * Handle command message from webview
   */
  private async handleCommand(
    message: CommandMessage,
    document: vscode.TextDocument
  ): Promise<void> {
    switch (message.command) {
      case 'save':
        await this.handleSaveCommand(document);
        break;
      case 'validate':
        await this.handleValidateCommand(document);
        break;
      case 'openFile':
        await this.handleOpenFileCommand(document, (message as any).path);
        break;
      default:
        this.logger.warn('Unknown command', message.command);
    }
  }

  /**
   * Handle openFile command
   */
  private async handleOpenFileCommand(
    document: vscode.TextDocument,
    filePath: string
  ): Promise<void> {
    try {
      // Resolve path relative to current document
      const currentDir = vscode.Uri.joinPath(document.uri, '..');
      const targetUri = vscode.Uri.joinPath(currentDir, filePath);

      // Open string paths or relative paths
      await vscode.commands.executeCommand('vscode.open', targetUri);
      this.logger.info('Opened file:', targetUri.toString());
    } catch (e) {
      this.logger.error('Failed to open file', e as Error);
      vscode.window.showErrorMessage(`Failed to open file: ${filePath}`);
    }
  }

  /**
   * Handle save command
   */
  private async handleSaveCommand(document: vscode.TextDocument): Promise<void> {
    await document.save();
    this.logger.info('Document saved');
  }

  /**
   * Handle validate command
   */
  private async handleValidateCommand(document: vscode.TextDocument): Promise<void> {
    const result = this.yamlValidator.validate(document.getText());

    if (result.valid) {
      await vscode.window.showInformationMessage('YAML parsed successfully.');
      this.logger.info('YAML validation successful');
    } else {
      await vscode.window.showErrorMessage(`YAML parse error: ${result.error ?? 'Unknown error'}`);
      this.logger.warn('YAML validation failed', result.error);
    }
  }

  /**
   * Send an update message to the webview
   */
  sendUpdate(webview: vscode.Webview, document: vscode.TextDocument): void {
    void webview.postMessage({
      type: 'update',
      text: this.documentManager.getText(document),
      fileName: this.documentManager.getRelativePath(document.uri),
    });
    this.logger.debug('Sent update to webview');
  }
}
