import * as vscode from 'vscode';
import { STAGING_SCHEME, setStagingContent, clearStagingContent } from './StagingContentProvider';
import type { StagedFile } from './StagingPanel';

/**
 * Singleton bridge between GenerateCommands (extension host) and the active canvas webview.
 * When a canvas webview is registered for a document, staging confirmation is shown inside
 * the canvas inspector slot instead of opening a separate StagingPanel webview.
 */
export class WebviewStagingBridge {
  private static readonly _instance = new WebviewStagingBridge();
  static getInstance(): WebviewStagingBridge {
    return this._instance;
  }

  private readonly panels = new Map<string, vscode.WebviewPanel>();
  private readonly resolvers = new Map<string, (confirmed: boolean) => void>();
  private readonly stagedFiles = new Map<string, StagedFile[]>();

  register(fsPath: string, panel: vscode.WebviewPanel): void {
    this.panels.set(fsPath, panel);
    panel.onDidDispose(() => {
      this.panels.delete(fsPath);
      // Cancel any in-progress staging for this panel
      const resolver = this.resolvers.get(fsPath);
      if (resolver) {
        resolver(false);
        this.resolvers.delete(fsPath);
        this.stagedFiles.delete(fsPath);
      }
    });
  }

  /**
   * Send staged files to the canvas webview and wait for the user's decision.
   * Returns null if no registered webview exists for `fsPath` — caller should
   * fall back to the standalone StagingPanel.
   */
  async showInWebview(
    fsPath: string,
    files: StagedFile[],
    rootLabel?: string
  ): Promise<boolean | null> {
    const panel = this.panels.get(fsPath);
    if (!panel) {
      return null;
    }

    // Populate virtual FS so diff / preview actions work immediately
    clearStagingContent();
    for (const f of files) {
      setStagingContent(`/${f.relativePath}`, f.content);
    }
    this.stagedFiles.set(fsPath, files);

    // Only send display data to the webview — content can be large and isn't needed there
    const fileViews = files.map(({ relativePath, status, protected: prot }) => ({
      relativePath,
      status,
      protected: prot,
    }));

    return new Promise<boolean>((resolve) => {
      this.resolvers.set(fsPath, resolve);
      void panel.webview.postMessage({ type: 'stagingStart', files: fileViews, rootLabel });
    });
  }

  resolveStaging(fsPath: string, confirmed: boolean): void {
    const resolver = this.resolvers.get(fsPath);
    if (resolver) {
      resolver(confirmed);
      this.resolvers.delete(fsPath);
      this.stagedFiles.delete(fsPath);
    }
  }

  /** Returns the full StagedFile[] (with content + diskPath) for diff/preview actions. */
  getFiles(fsPath: string): StagedFile[] | undefined {
    return this.stagedFiles.get(fsPath);
  }

  /** Exposes the STAGING_SCHEME for use in extension-side message handlers. */
  static get scheme(): string {
    return STAGING_SCHEME;
  }
}
