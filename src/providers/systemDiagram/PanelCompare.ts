/**
 * The comparison of one System Viewer panel: the base design and the file it came from, the
 * three webview gestures (start, stop, swap), and the swap request that waits for this panel.
 * The provider publishes; this controller decides what the comparison is.
 */

import * as vscode from 'vscode';
import {
  SystemDesignCompare,
  type CompareResult,
  type CurrentSide,
  type GraphEnricher,
} from '../../services/systemDiagram/compare/SystemDesignCompare';
import type { SystemGraph } from '../../domain/systemGraph';
import type { DiagramCompare } from '../../shared/messages/systemDiagram';
import { EDITOR_VIEW_TYPE_SYSTEM_DIAGRAM } from '../../utils/editorViewTypes';
import type { DiagramPanels } from './DiagramPanels';
import { pickCompareBase, type CompareBase } from './pickCompareBase';

export interface PanelCompareOptions {
  document: vscode.TextDocument;
  webviewPanel: vscode.WebviewPanel;
  panels: DiagramPanels;
  enricher: GraphEnricher<vscode.Uri>;
  logError: (message: string, error: Error) => void;
  /** Publishes the current graph again with the comparison as it is now. */
  republish: () => Promise<void>;
}

export class PanelCompare {
  private readonly compare: SystemDesignCompare<vscode.Uri>;
  private readonly document: vscode.TextDocument;
  private readonly webviewPanel: vscode.WebviewPanel;
  private readonly panels: DiagramPanels;
  private readonly republish: () => Promise<void>;
  /** The file the base was read from; undefined for a git revision or without a comparison. */
  private baseFile: vscode.Uri | undefined;
  /** A swap request for this document, started with the first graph once the panel is ready. */
  private waiting: CompareBase | undefined;
  private disposed = false;

  constructor(options: PanelCompareOptions) {
    this.document = options.document;
    this.webviewPanel = options.webviewPanel;
    this.panels = options.panels;
    this.republish = options.republish;
    this.compare = new SystemDesignCompare(options.enricher, options.logError);
    const uri = this.document.uri.toString();
    this.waiting = this.panels.take(uri);
    this.panels.add(this.webviewPanel, {
      uri,
      pickBase: () => this.pick(),
      startWith: (base) => this.startWith(base),
      reveal: () => this.webviewPanel.reveal(this.webviewPanel.viewColumn),
    });
  }

  /** The workspace-relative path of the document: the current side's label. */
  get currentLabel(): string {
    return vscode.workspace.asRelativePath(this.document.uri, false);
  }

  get active(): boolean {
    return this.compare.active;
  }

  diffEnriched(sides: CurrentSide): Promise<CompareResult | undefined> {
    return this.compare.diffEnriched(sides, this.document.fileName);
  }

  diffRead(read: SystemGraph): CompareResult | undefined {
    return this.compare.diffRead(read);
  }

  /** The `compare` part of a `graph` message. */
  describe(changes: CompareResult): DiagramCompare {
    return {
      ...changes,
      // An untrusted workspace's definitions are not read, for either side.
      baseDefinitions: vscode.workspace.isTrusted ? changes.baseDefinitions : 'none',
      currentLabel: this.currentLabel,
      canSwap: this.baseFile !== undefined,
    };
  }

  /** Called when the webview is ready: a swap that waited for this panel starts before the first graph. */
  onReady(): void {
    const swapped = this.waiting;
    this.waiting = undefined;
    if (swapped) {
      try {
        this.applyBase(swapped);
      } catch (error) {
        this.reportFailure(error);
      }
    }
  }

  /** Asks for a base and starts the comparison. */
  pick(): Promise<void> {
    return this.begin(() => pickCompareBase(this.document));
  }

  startWith(base: CompareBase): Promise<void> {
    return this.begin(() => base);
  }

  async stop(): Promise<void> {
    this.waiting = undefined;
    this.compare.stop();
    this.baseFile = undefined;
    await this.republish();
  }

  /** Opens the base file as a diagram and compares it with this document. */
  async swap(): Promise<void> {
    const target = this.baseFile;
    if (!target) {
      return;
    }
    const key = target.toString();
    const reverse: CompareBase = {
      text: this.document.getText(),
      label: this.currentLabel,
      file: this.document.uri,
    };
    // openWith opens a second editor when the file is open in another group (verified in the
    // e2e suite's notes on VS Code 1.80 to 1.129): reveal the open panel instead.
    const open = this.panels.byUri(key);
    if (open) {
      open.reveal();
      await open.startWith(reverse);
      return;
    }
    this.panels.request(key, reverse, this.webviewPanel);
    try {
      await vscode.commands.executeCommand(
        'vscode.openWith',
        target,
        EDITOR_VIEW_TYPE_SYSTEM_DIAGRAM
      );
    } catch (error) {
      this.panels.cancel(key, this.webviewPanel);
      void vscode.window.showErrorMessage(
        `Cannot open ${vscode.workspace.asRelativePath(target, false)}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }
    // A panel that registered has taken the request; if none has yet, it may still come.
    this.panels.expireLater(key, this.webviewPanel);
  }

  /** The panel is gone: nothing starts or is reported after that. */
  dispose(): void {
    this.disposed = true;
    this.waiting = undefined;
    this.panels.remove(this.webviewPanel);
  }

  private applyBase(base: CompareBase): void {
    // A swap request that still waits for `ready` must not override a newer base.
    this.waiting = undefined;
    // A file is read in its own format; a revision of the document is in the document's.
    const formatPath = base.file?.fsPath ?? this.document.fileName;
    this.compare.start(base.text, this.currentLabel, base.label, formatPath, {
      missing: base.missing,
      renamedFrom: base.renamedFrom,
      readDefinitionAt: base.readDefinitionAt,
    });
    this.baseFile = base.file;
  }

  private reportFailure(error: unknown): void {
    if (!this.disposed) {
      void vscode.window.showErrorMessage(
        `Compare failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async begin(
    getBase: () => Promise<CompareBase | undefined> | CompareBase
  ): Promise<void> {
    try {
      const base = await getBase();
      if (!base || this.disposed) {
        return;
      }
      this.applyBase(base);
    } catch (error) {
      this.reportFailure(error);
      return;
    }
    await this.republish();
  }
}
