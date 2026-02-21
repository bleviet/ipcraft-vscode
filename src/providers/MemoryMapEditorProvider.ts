import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';
import { HtmlGenerator } from '../services/HtmlGenerator';
import { MessageHandler } from '../services/MessageHandler';
import { DocumentManager } from '../services/DocumentManager';
import { createSharedProviderServices } from './providerServices';

/**
 * Custom editor provider for FPGA memory map YAML files
 */
export class MemoryMapEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly logger = new Logger('MemoryMapEditorProvider');
  private readonly htmlGenerator: HtmlGenerator;
  private readonly messageHandler: MessageHandler;
  private readonly documentManager: DocumentManager;

  constructor(private readonly context: vscode.ExtensionContext) {
    const services = createSharedProviderServices(context);
    this.htmlGenerator = services.htmlGenerator;
    this.messageHandler = services.messageHandler;
    this.documentManager = services.documentManager;

    this.logger.info('MemoryMapEditorProvider initialized');
  }

  /**
   * Resolve the custom text editor for a document
   */
  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void {
    this.logger.info('Resolving custom text editor for document', document.uri.toString());

    // Configure webview
    webviewPanel.webview.options = {
      enableScripts: true,
    };

    // Set HTML content
    webviewPanel.webview.html = this.htmlGenerator.generateHtml(webviewPanel.webview);

    let isReady = false;

    // Send update to webview when ready
    const updateWebview = () => {
      if (!isReady) {
        return;
      }
      this.messageHandler.sendUpdate(webviewPanel.webview, document);
    };

    // Listen for document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        updateWebview();
      }
    });

    // Clean up subscriptions when webview is disposed
    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      this.logger.debug('Webview panel disposed');
    });

    // Handle messages from the webview
    webviewPanel.webview.onDidReceiveMessage((m: unknown) => {
      const message = m as { type?: string; command: string };
      if (message.type === 'ready') {
        isReady = true;
        updateWebview();
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      void this.messageHandler.handleMessage(message as any, document);
    });

    // Queue initial content until webview signals readiness
    updateWebview();
  }
}
