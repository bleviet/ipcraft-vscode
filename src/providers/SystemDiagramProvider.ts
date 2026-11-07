import * as vscode from 'vscode';
import { HtmlGenerator } from '../services/HtmlGenerator';
import { readSystemDesign } from '../services/systemDiagram/readSystemDesign';
import { SystemDesignEnricher } from '../services/systemDiagram/SystemDesignEnricher';
import type { SystemGraph } from '../domain/systemGraph';
import { WebviewRouter } from '../services/WebviewRouter';
import type {
  SystemDiagramToExtensionMessage,
  SystemDiagramToWebviewMessage,
} from '../shared/messages/systemDiagram';
import { pruneHighlights } from '../webview/systemDiagram/highlights';
import { Logger } from '../utils/Logger';

/** Read-only custom editor that draws a block design script as a system diagram. */
export class SystemDiagramProvider implements vscode.CustomTextEditorProvider {
  private readonly logger = new Logger('SystemDiagramProvider');
  private readonly htmlGenerator: HtmlGenerator;

  private readonly enricher = new SystemDesignEnricher();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.htmlGenerator = new HtmlGenerator(context);
    context.subscriptions.push(this.enricher);
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

    let sequence = 0;
    let lastGraph: SystemGraph | undefined;
    const storageKey = `ipcraft.systemDiagram.highlights:${document.uri.toString()}`;

    const postGraph = async () => {
      const current = ++sequence;
      const fileName = vscode.workspace.asRelativePath(document.uri, false);
      try {
        const read = readSystemDesign(document.fileName, fileName, document.getText());
        if (!read) {
          post({ type: 'notRecognized', fileName });
          return;
        }
        const graph = await this.enricher
          .enrich(read, document.fileName)
          .catch((error: unknown) => {
            this.logger.error('Failed to enrich system design', error as Error);
            return read;
          });
        if (current === sequence) {
          lastGraph = graph;
          const raw = this.context.workspaceState?.get<unknown>(storageKey);
          const highlights = pruneHighlights(graph, raw);
          if (
            raw !== undefined &&
            (typeof raw !== 'object' ||
              raw === null ||
              Object.keys(highlights).length !== Object.keys(raw).length)
          ) {
            void this.context.workspaceState?.update(
              storageKey,
              Object.keys(highlights).length > 0 ? highlights : undefined
            );
          }
          post({
            type: 'graph',
            graph,
            ...(Object.keys(highlights).length > 0 && { highlights }),
          });
        }
      } catch (error) {
        if (current !== sequence) {
          return;
        }
        this.logger.error('Failed to read system design', error as Error);
        post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    };

    const router = new WebviewRouter<SystemDiagramToExtensionMessage>({
      webviewPanel,
      document,
      logger: this.logger,
      onReady: () => void postGraph(),
    });

    router.on('revealSource', async (message) => {
      const line = Math.max(message.line - 1, 0);
      let target = document;
      if (message.uri !== undefined) {
        // Only files a level was read from may be opened.
        const known = Object.values(lastGraph?.levels ?? {}).some(
          (level) => level.source?.uri === message.uri
        );
        if (!known) {
          return;
        }
        target = await vscode.workspace.openTextDocument(vscode.Uri.parse(message.uri));
      }
      await vscode.window.showTextDocument(target, {
        viewColumn: vscode.ViewColumn.Beside,
        selection: new vscode.Range(line, 0, line, 0),
        preserveFocus: false,
      });
    });

    router.on('openDefinition', async (message) => {
      const definition = lastGraph?.instances[message.instance]?.definition;
      if (!definition) {
        return;
      }
      const uri = vscode.Uri.parse(definition.uri);
      if (definition.kind === 'ip.yml') {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          uri,
          'fpgaIpCore.editor',
          vscode.ViewColumn.Beside
        );
      } else {
        await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside });
      }
    });

    router.on('setHighlights', async (message) => {
      const highlights = pruneHighlights(lastGraph, message.highlights);
      await this.context.workspaceState?.update(
        storageKey,
        Object.keys(highlights).length > 0 ? highlights : undefined
      );
    });

    const documentChanges = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() === document.uri.toString()) {
        void postGraph();
      }
    });
    // Granting trust lets the enricher read definitions it skipped before.
    const trustGranted = vscode.workspace.onDidGrantWorkspaceTrust(() => {
      void postGraph();
    });
    webviewPanel.onDidDispose(() => {
      documentChanges.dispose();
      trustGranted.dispose();
      router.dispose();
    });
  }
}
