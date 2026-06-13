import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';
import { HtmlGenerator } from '../services/HtmlGenerator';
import { WebviewRouter } from '../services/WebviewRouter';
import { DocumentManager } from '../services/DocumentManager';
import { YamlValidator } from '../services/YamlValidator';
import { createSharedProviderServices } from './providerServices';

/**
 * Custom editor provider for FPGA memory map YAML files
 */
export class MemoryMapEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly logger = new Logger('MemoryMapEditorProvider');
  private readonly htmlGenerator: HtmlGenerator;
  private readonly yamlValidator: YamlValidator;
  private readonly documentManager: DocumentManager;

  constructor(private readonly context: vscode.ExtensionContext) {
    const services = createSharedProviderServices(context);
    this.htmlGenerator = services.htmlGenerator;
    this.yamlValidator = services.yamlValidator;
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

    const router = new WebviewRouter({
      webviewPanel,
      document,
      logger: this.logger,
      onReady: () => {
        router.postUpdate({
          text: this.documentManager.getText(document),
          fileName: this.documentManager.getRelativePath(document.uri),
        });
      },
    });

    router.useStandardDocumentHandlers(this.documentManager, this.yamlValidator);

    // Listen for document changes
    const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      router.handleDocumentChange(e);
    });

    // Clean up subscriptions when webview is disposed
    webviewPanel.onDidDispose(() => {
      changeDocumentSubscription.dispose();
      router.dispose();
      this.logger.debug('Webview panel disposed');
    });
  }
}
