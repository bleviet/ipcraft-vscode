import * as vscode from 'vscode';
import * as path from 'path';
import * as jsyaml from 'js-yaml';
import { Logger } from '../utils/Logger';
import { HtmlGenerator } from '../services/HtmlGenerator';
import { MessageHandler } from '../services/MessageHandler';
import { DocumentManager } from '../services/DocumentManager';
import { ImportResolver } from '../services/ImportResolver';
import { createNotIpCoreHtml } from './ipCoreErrorHtml';
import { createSharedProviderServices } from './providerServices';
import {
  handleGenerateRequest,
  type GenerateRequestMessage,
  type GenerateOptionsMessage,
} from './IpCoreGenerateHandler';

interface IpcMessage {
  type: string;
  multi?: boolean;
  filters?: Record<string, string[]>;
  paths?: string[];
  options?: GenerateOptionsMessage;
  [key: string]: unknown;
}

/**
 * Custom editor provider for FPGA IP core YAML files.
 *
 * Detects IP core files by checking for required keys: apiVersion + vlnv
 */
export class IpCoreEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly logger = new Logger('IpCoreEditorProvider');
  private readonly htmlGenerator: HtmlGenerator;
  private readonly messageHandler: MessageHandler;
  private readonly documentManager: DocumentManager;
  private readonly importResolver: ImportResolver;

  constructor(private readonly context: vscode.ExtensionContext) {
    const services = createSharedProviderServices(context);
    this.htmlGenerator = services.htmlGenerator;
    this.messageHandler = services.messageHandler;
    this.documentManager = services.documentManager;
    this.importResolver = new ImportResolver(this.logger, context);

    this.logger.info('IpCoreEditorProvider initialized');
  }

  /**
   * Check if a document is an IP core YAML file.
   *
   * Detection strategy: Check for required keys (apiVersion + vlnv)
   * This allows *.yml files to work while avoiding false positives.
   */
  private isIpCoreDocument(document: vscode.TextDocument): boolean {
    try {
      const text = document.getText();
      const parsed = jsyaml.load(text);

      if (!parsed || typeof parsed !== 'object') {
        return false;
      }

      // Check for IP core signature: apiVersion + vlnv
      const data = parsed as Record<string, unknown>;
      // apiVersion can be string or number (YAML parses "1.0" as number)
      const hasApiVersion =
        'apiVersion' in data &&
        (typeof data.apiVersion === 'string' || typeof data.apiVersion === 'number');
      const hasVlnv = 'vlnv' in data && typeof data.vlnv === 'object';

      return hasApiVersion && hasVlnv;
    } catch (error) {
      // YAML parse error - not a valid IP core file
      return false;
    }
  }

  /**
   * Resolve the custom text editor for a document.
   */
  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void {
    this.logger.info('Resolving custom text editor for document', document.uri.toString());

    // Check if this is actually an IP core file
    const isIpCore = this.isIpCoreDocument(document);
    if (!isIpCore) {
      this.logger.info('Document is not an IP core file, showing error in webview');
      webviewPanel.webview.options = { enableScripts: false };
      webviewPanel.webview.html = createNotIpCoreHtml();
      return;
    }

    this.logger.info('Document is an IP core file');

    // Configure webview
    webviewPanel.webview.options = {
      enableScripts: true,
    };

    // Set HTML content - use ipcore-specific HTML
    webviewPanel.webview.html = this.htmlGenerator.generateIpCoreHtml(webviewPanel.webview);

    let isDisposed = false;

    const updateWebview = async () => {
      await this.updateWebview(document, webviewPanel, () => isDisposed);
    };

    const changeDocumentSubscription = this.subscribeToDocumentChanges(document, updateWebview);
    this.registerDisposal(webviewPanel, () => {
      isDisposed = true;
      changeDocumentSubscription.dispose();
    });
    this.registerWebviewMessageHandlers(document, webviewPanel, updateWebview);

    setTimeout(() => {
      void updateWebview();
    }, 100);
  }

  private subscribeToDocumentChanges(
    document: vscode.TextDocument,
    updateWebview: () => Promise<void>
  ): vscode.Disposable {
    return vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        void updateWebview();
      }
    });
  }

  private registerDisposal(webviewPanel: vscode.WebviewPanel, onDispose: () => void): void {
    webviewPanel.onDidDispose(() => {
      onDispose();
      this.logger.debug('Webview panel disposed');
    });
  }

  private registerWebviewMessageHandlers(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    updateWebview: () => Promise<void>
  ): void {
    type MessageHandlerFn = (message: IpcMessage) => Promise<void>;

    const messageHandlers: Record<string, MessageHandlerFn> = {
      ready: async () => {
        this.logger.info('Webview ready, sending initial update');
        await updateWebview();
      },
      selectFiles: async (message) => {
        await this.handleSelectFilesMessage(message, document, webviewPanel);
      },
      checkFilesExist: async (message) => {
        await this.handleCheckFilesExistMessage(message, document, webviewPanel);
      },
      generate: async (message) => {
        await handleGenerateRequest({
          logger: this.logger,
          context: this.context,
          documentManager: this.documentManager,
          document,
          webview: webviewPanel.webview,
          message: message as GenerateRequestMessage,
          refreshWebview: updateWebview,
        });
      },
    };

    webviewPanel.webview.onDidReceiveMessage(async (message: IpcMessage) => {
      const handler = messageHandlers[message.type];
      if (handler) {
        await handler(message);
        return;
      }
      await this.messageHandler.handleMessage(message, document);
    });
  }

  private async updateWebview(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    isDisposed: () => boolean
  ): Promise<void> {
    if (isDisposed()) {
      this.logger.debug('Webview already disposed, skipping update');
      return;
    }

    try {
      const text = document.getText();
      const parsed = jsyaml.load(text);
      const baseDir = path.dirname(document.uri.fsPath);
      const imports = await this.importResolver.resolveImports(
        parsed as Record<string, unknown>,
        baseDir
      );

      if (isDisposed()) {
        this.logger.debug('Webview disposed during import resolution, skipping update');
        return;
      }

      void webviewPanel.webview.postMessage({
        type: 'update',
        text,
        fileName: path.basename(document.uri.fsPath),
        imports,
      });
    } catch (error) {
      this.logger.error('Failed to update webview', error as Error);
    }
  }

  private async handleSelectFilesMessage(
    message: IpcMessage,
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    this.logger.info('Opening file picker dialog');
    const options: vscode.OpenDialogOptions = {
      canSelectMany: message.multi ?? true,
      openLabel: 'Select Files',
      canSelectFiles: true,
      canSelectFolders: false,
      filters: message.filters,
    };

    const fileUris = await vscode.window.showOpenDialog(options);
    if (!fileUris || fileUris.length === 0) {
      return;
    }

    const baseDir = path.dirname(document.uri.fsPath);
    const relativePaths = fileUris.map((uri) => path.relative(baseDir, uri.fsPath));
    void webviewPanel.webview.postMessage({
      type: 'filesSelected',
      files: relativePaths,
    });
    this.logger.info(`Selected ${relativePaths.length} file(s)`);
  }

  private async handleCheckFilesExistMessage(
    message: IpcMessage,
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    const baseDir = path.dirname(document.uri.fsPath);
    const filePaths: string[] = message.paths ?? [];
    const results: Record<string, boolean> = {};

    for (const filePath of filePaths) {
      try {
        const fullPath = path.isAbsolute(filePath) ? filePath : path.join(baseDir, filePath);
        await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
        results[filePath] = true;
      } catch {
        results[filePath] = false;
      }
    }

    void webviewPanel.webview.postMessage({
      type: 'filesExistResult',
      results,
    });
    this.logger.debug(`Checked ${filePaths.length} file(s) for existence`);
  }
}
