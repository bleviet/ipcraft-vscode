/**
 * The open System Viewer panels and the swap requests between them. A swap opens the base file
 * of a comparison as a diagram and compares it with the document it was started from; if that
 * diagram is not open yet, the request waits here until its panel becomes ready.
 */

import type * as vscode from 'vscode';
import type { CompareBase } from './pickCompareBase';

/** What the provider can do with one open panel. */
export interface PanelHandle {
  /** The document's URI as a string. */
  uri: string;
  /** Asks for a base and starts the comparison. */
  pickBase(): Promise<void>;
  /** Starts the comparison with this base, replacing a running one. */
  startWith(base: CompareBase): Promise<void>;
  /** Shows the panel in its editor group. */
  reveal(): void;
}

/** How long a request survives `openWith` having resolved while no panel has taken it yet. */
export const SWAP_GRACE_MS = 5000;

interface SwapRequest {
  base: CompareBase;
  requester: vscode.WebviewPanel;
  /** Set once the request only waits for a late panel. */
  timer?: ReturnType<typeof setTimeout>;
}

export class DiagramPanels {
  private readonly open = new Map<vscode.WebviewPanel, PanelHandle>();
  private readonly pending = new Map<string, SwapRequest>();

  add(panel: vscode.WebviewPanel, handle: PanelHandle): void {
    this.open.set(panel, handle);
  }

  /** Forgets the panel and the swap requests it made. */
  remove(panel: vscode.WebviewPanel): void {
    this.open.delete(panel);
    for (const [uri, request] of this.pending) {
      if (request.requester === panel) {
        this.drop(uri);
      }
    }
  }

  active(): PanelHandle | undefined {
    for (const [panel, handle] of this.open) {
      if (panel.active) {
        return handle;
      }
    }
    return undefined;
  }

  /** The panel that shows `uri`: a visible one if there are several, else the first. */
  byUri(uri: string): PanelHandle | undefined {
    const shows = [...this.open].filter(([, handle]) => handle.uri === uri);
    return (shows.find(([panel]) => panel.visible) ?? shows[0])?.[1];
  }

  /** `requester` waits for a panel of `uri` to open; it will compare with `base`. */
  request(uri: string, base: CompareBase, requester: vscode.WebviewPanel): void {
    this.drop(uri);
    this.pending.set(uri, { base, requester });
  }

  /**
   * `openWith` resolved: a panel that registers within the grace period still takes the
   * request, then it is dropped, so a later panel never starts a stale comparison.
   */
  expireLater(uri: string, requester: vscode.WebviewPanel): void {
    const request = this.pending.get(uri);
    if (request?.requester === requester) {
      clearTimeout(request.timer);
      request.timer = setTimeout(() => this.drop(uri), SWAP_GRACE_MS);
    }
  }

  /** Drops the request of `requester` for `uri`, if it is still waiting. */
  cancel(uri: string, requester: vscode.WebviewPanel): void {
    if (this.pending.get(uri)?.requester === requester) {
      this.drop(uri);
    }
  }

  /** The base a panel of `uri` that just registered has to start with, once. */
  take(uri: string): CompareBase | undefined {
    const base = this.pending.get(uri)?.base;
    this.drop(uri);
    return base;
  }

  private drop(uri: string): void {
    clearTimeout(this.pending.get(uri)?.timer);
    this.pending.delete(uri);
  }
}
