import * as vscode from 'vscode';
import { HtmlGenerator } from '../services/HtmlGenerator';
import { readSystemDesign } from '../services/systemDiagram/readSystemDesign';
import { SystemDesignEnricher } from '../services/systemDiagram/SystemDesignEnricher';
import type {
  CompareResult,
  CurrentSide,
} from '../services/systemDiagram/compare/SystemDesignCompare';
import type { SystemGraph } from '../domain/systemGraph';
import { WebviewRouter } from '../services/WebviewRouter';
import type {
  SystemDiagramToExtensionMessage,
  SystemDiagramToWebviewMessage,
} from '../shared/messages/systemDiagram';
import { pruneHighlights } from '../webview/systemDiagram/highlights';
import type { RenderAssets } from '../services/render/renderResources';
import type { RenderRoots } from '../services/render/imageEncoding';
import { Logger } from '../utils/Logger';
import { settleWithin, STILL_PENDING } from './settleWithin';
import { ExportTargets } from './imageExport/ExportTargets';
import { ImageExportHost } from './imageExport/ImageExportHost';
import { DiagramPanels } from './systemDiagram/DiagramPanels';
import { PanelCompare } from './systemDiagram/PanelCompare';

/** How long to wait for workspace enrichment before showing the parsed graph. */
export const ENRICHMENT_GRACE_MS = 100;

/** Read-only custom editor that draws a block design script as a system diagram. */
export class SystemDiagramProvider implements vscode.CustomTextEditorProvider {
  private readonly logger = new Logger('SystemDiagramProvider');
  private readonly htmlGenerator: HtmlGenerator;

  private readonly enricher = new SystemDesignEnricher();

  private readonly imageExport: ImageExportHost;

  private readonly panels = new DiagramPanels();

  constructor(
    private readonly context: vscode.ExtensionContext,
    resourceRoots: RenderRoots,
    private readonly exportTargets: ExportTargets,
    assets: RenderAssets
  ) {
    this.htmlGenerator = new HtmlGenerator(context);
    context.subscriptions.push(this.enricher);
    this.imageExport = new ImageExportHost({
      memento: context.workspaceState,
      assets,
      roots: resourceRoots,
      logger: this.logger,
    });
  }

  /** Starts the comparison of the active diagram panel; false when none is active. */
  compareActive(): boolean {
    const active = this.panels.active();
    if (active) {
      void active.pickBase();
    }
    return active !== undefined;
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
    /** False while `lastGraph` is the early, not yet enriched graph. */
    let lastGraphFinal = true;
    /** The sides of `lastGraph` while it is final. */
    let lastSides: CurrentSide | undefined;
    /** The problem the webview shows over `lastGraph`; a published graph clears it. */
    let lastProblem:
      | Extract<SystemDiagramToWebviewMessage, { type: 'notRecognized' | 'error' }>
      | undefined;
    const compare = new PanelCompare({
      document,
      webviewPanel,
      panels: this.panels,
      enricher: this.enricher,
      logError: (message, error) => this.logger.error(message, error),
      republish: () => republish(),
    });
    /** Set when the panel is gone: nothing is published or stored after that. */
    let disposed = false;
    const storageKey = `ipcraft.systemDiagram.highlights:${document.uri.toString()}`;

    /** Posts a graph with its remembered highlights; only `persist` prunes workspaceState. */
    const publish = (graph: SystemGraph, persist: boolean, changes?: CompareResult) => {
      lastGraph = graph;
      lastProblem = undefined;
      lastGraphFinal = persist;
      const raw = this.context.workspaceState?.get<unknown>(storageKey);
      const highlights = pruneHighlights(graph, raw);
      if (
        persist &&
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
        ...(changes && { compare: compare.describe(changes) }),
      });
    };

    const postProblem = (message: NonNullable<typeof lastProblem>) => {
      lastProblem = message;
      post(message);
    };

    const postGraph = async () => {
      const current = ++sequence;
      const fileName = compare.currentLabel;
      try {
        const read = readSystemDesign(document.fileName, fileName, document.getText());
        if (!read) {
          postProblem({ type: 'notRecognized', fileName });
          return;
        }
        let fellBack = false;
        const enrichment = this.enricher.enrich(read, document.fileName).catch((error: unknown) => {
          this.logger.error('Failed to enrich system design', error as Error);
          fellBack = true;
          return read;
        });
        const quick = await settleWithin(enrichment, ENRICHMENT_GRACE_MS);
        if (quick !== STILL_PENDING) {
          const sides = { read, enriched: quick, fellBack };
          const changes = compare.active ? await compare.diffEnriched(sides) : undefined;
          if (current === sequence) {
            lastSides = sides;
            publish(quick, true, changes);
          }
          return;
        }
        // Slow enrichment: show the parsed graph now, the enriched one when ready.
        if (current === sequence) {
          publish(
            {
              ...read,
              diagnostics: [
                ...read.diagnostics,
                { severity: 'info', message: 'Resolving workspace definitions…' },
              ],
            },
            false,
            compare.diffRead(read)
          );
        }
        const graph = await enrichment;
        const sides = { read, enriched: graph, fellBack };
        const changes = compare.active ? await compare.diffEnriched(sides) : undefined;
        if (current === sequence) {
          lastSides = sides;
          publish(graph, true, changes);
        }
      } catch (error) {
        if (current !== sequence) {
          return;
        }
        this.logger.error('Failed to read system design', error as Error);
        postProblem({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    /** Publishes the graph on show again, with the comparison as it is now. */
    const republish = async () => {
      const graph = lastGraph;
      if (!graph) {
        return;
      }
      const final = lastGraphFinal;
      const sides = lastSides;
      const changes = final && sides ? await compare.diffEnriched(sides) : compare.diffRead(graph);
      // A newer graph replaced this one meanwhile and carries the comparison itself.
      if (!disposed && graph === lastGraph) {
        // The webview keeps this graph under a problem banner; a graph message would clear it.
        const problem = lastProblem;
        publish(graph, final && !problem, changes);
        if (problem) {
          lastGraphFinal = final;
          postProblem(problem);
        }
      }
    };

    const router = new WebviewRouter<SystemDiagramToExtensionMessage>({
      webviewPanel,
      document,
      logger: this.logger,
      onReady: () => {
        // A swap from another panel waits for this one: its comparison goes out with the first graph.
        compare.onReady();
        const remembered = this.imageExport.rememberedOptions('systemDiagram');
        if (remembered) {
          post({ type: 'exportOptions', options: remembered });
        }
        void postGraph();
      },
    });
    const exportTarget = this.exportTargets.register(webviewPanel, 'systemDiagram');

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
      let highlights = pruneHighlights(lastGraph, message.highlights);
      if (!lastGraphFinal) {
        // The webview only knows the highlights the early graph showed. Carry over
        // the stored ones that graph hid (instances only enrichment adds); the final
        // publish prunes them against the enriched graph. Trade-off: "clear all"
        // during the grace window keeps those hidden entries.
        const stored = pruneHighlights(undefined, this.context.workspaceState?.get(storageKey));
        const shown = pruneHighlights(lastGraph, stored);
        const hidden = Object.fromEntries(
          Object.entries(stored).filter(([key]) => !(key in shown))
        );
        highlights = { ...hidden, ...pruneHighlights(undefined, message.highlights) };
      }
      await this.context.workspaceState?.update(
        storageKey,
        Object.keys(highlights).length > 0 ? highlights : undefined
      );
    });

    router.on('exportImage', async (message) => {
      await this.imageExport.exportSystem(document, lastGraph, message);
    });

    router.on('startCompare', () => compare.pick());
    router.on('stopCompare', () => compare.stop());
    router.on('swapCompare', () => compare.swap());

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
      disposed = true;
      compare.dispose();
      documentChanges.dispose();
      trustGranted.dispose();
      exportTarget.dispose();
      router.dispose();
    });
  }
}
