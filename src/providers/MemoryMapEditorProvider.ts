import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';
import { HtmlGenerator } from '../services/HtmlGenerator';
import { WebviewRouter } from '../services/WebviewRouter';
import { DocumentManager } from '../services/DocumentManager';
import { YamlValidator } from '../services/YamlValidator';
import { createSharedProviderServices } from './providerServices';
import { getLiveRegisterSession } from '../commands/LiveDebugCommands';
import { RegisterTransportError } from '../services/transport/RegisterTransport';

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

    // Live hardware register reads (issue #36 Part B) — a distinct message
    // type from 'update'/'command', kept off the document write-back path.
    // See WebviewRouter.postLiveValues for why this can never advance
    // docVersion or the revisioned sync FIFO.
    router.on('readRegister', async (message) => {
      const { name } = message as unknown as { name: string };
      const session = getLiveRegisterSession(document.uri);
      if (!session) {
        router.postLiveValues({ errors: { [name]: 'Not connected' } });
        return;
      }
      try {
        const result = await session.readRegister(name);
        router.postLiveValues({ values: { [result.name]: result.value } });
      } catch (err) {
        const msg =
          err instanceof RegisterTransportError
            ? `[${err.category}] ${err.message}`
            : err instanceof Error
              ? err.message
              : String(err);
        router.postLiveValues({ errors: { [name]: msg } });
      }
    });

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
