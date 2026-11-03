import * as vscode from 'vscode';
import { readBdTcl } from '../parser/system/BdTclReader';
import { HtmlGenerator } from '../services/HtmlGenerator';
import { isSystemDesignScript } from '../services/systemDiagram/systemDesignDetection';
import { WebviewRouter } from '../services/WebviewRouter';
import type {
  SystemDiagramToExtensionMessage,
  SystemDiagramToWebviewMessage,
} from '../shared/messages/systemDiagram';
import { Logger } from '../utils/Logger';

/** Read-only custom editor that draws a block design script as a system diagram. */
export class SystemDiagramProvider implements vscode.CustomTextEditorProvider {
  private readonly logger = new Logger('SystemDiagramProvider');
  private readonly htmlGenerator: HtmlGenerator;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.htmlGenerator = new HtmlGenerator(context);
  }

  resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): void {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };
    webviewPanel.webview.html = this.htmlGenerator.generateSystemDiagramHtml(webviewPanel.webview);

    const post = (message: SystemDiagramToWebviewMessage) => {
      void webviewPanel.webview.postMessage(message);
    };

    const postGraph = () => {
      const fileName = vscode.workspace.asRelativePath(document.uri, false);
      try {
        const text = document.getText();
        post(
          isSystemDesignScript(document.fileName, text)
            ? { type: 'graph', graph: readBdTcl(text, fileName) }
            : { type: 'notRecognized', fileName }
        );
      } catch (error) {
        this.logger.error('Failed to read system design', error as Error);
        post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    };

    const router = new WebviewRouter<SystemDiagramToExtensionMessage>({
      webviewPanel,
      document,
      logger: this.logger,
      onReady: postGraph,
    });

    router.on('revealSource', async (message) => {
      const line = Math.max(message.line - 1, 0);
      await vscode.window.showTextDocument(document, {
        viewColumn: vscode.ViewColumn.Beside,
        selection: new vscode.Range(line, 0, line, 0),
        preserveFocus: false,
      });
    });

    const documentChanges = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString()) {
        postGraph();
      }
    });
    webviewPanel.onDidDispose(() => {
      documentChanges.dispose();
      router.dispose();
    });
  }
}
