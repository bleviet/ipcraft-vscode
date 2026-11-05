/**
 * Lazily built, in-memory index of workspace files matching a glob. After the
 * first build a file watcher (created once) updates the index for the changed
 * file only. Files are read with a small concurrent pool.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import type { Logger } from '../../utils/Logger';
import { isIgnoredWorkspacePath } from './enrichment/workspaceFilter';

const READ_POOL_SIZE = 8;

export class WorkspaceFileIndex<T> {
  private entries?: Promise<Map<string, T>>;
  private watching = false;
  private disposables: vscode.Disposable[] = [];
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly glob: string,
    private readonly limit: number,
    /** Reads one file into an entry; undefined skips it. */
    private readonly read: (uri: vscode.Uri) => Promise<T | undefined>,
    private readonly logger: Logger
  ) {}

  async get(): Promise<T[]> {
    if (!this.entries) {
      this.watch();
      const building = this.build();
      this.entries = building;
      // A failed build is not cached: the next call retries.
      building.catch(() => {
        if (this.entries === building) {
          this.entries = undefined;
        }
      });
    }
    return [...(await this.entries).values()];
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
    this.watching = false;
    this.entries = undefined;
  }

  private async build(): Promise<Map<string, T>> {
    const found = await vscode.workspace.findFiles(this.glob, undefined, this.limit);
    const uris = found.filter((uri) => !isIgnoredWorkspacePath(uri.fsPath));
    const entries = new Map<string, T>();
    let next = 0;
    const worker = async () => {
      while (next < uris.length) {
        const uri = uris[next++];
        const entry = await this.readSafely(uri);
        if (entry !== undefined) {
          entries.set(uri.fsPath, entry);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(READ_POOL_SIZE, uris.length) }, worker));
    return entries;
  }

  private async readSafely(uri: vscode.Uri): Promise<T | undefined> {
    try {
      return await this.read(uri);
    } catch (error) {
      this.logger.warn(`Skipping unreadable file ${uri.fsPath}: ${String(error)}`);
      return undefined;
    }
  }

  private watch(): void {
    if (this.watching) {
      return;
    }
    this.watching = true;
    const watcher = vscode.workspace.createFileSystemWatcher(this.glob);
    const refresh = (uri: vscode.Uri) => this.update(uri, false);
    this.disposables.push(
      watcher,
      watcher.onDidCreate(refresh),
      watcher.onDidChange(refresh),
      watcher.onDidDelete((uri) => this.update(uri, true))
    );
  }

  /** Re-reads (or removes) one file, in event order, once the index is built. */
  private update(uri: vscode.Uri, removed: boolean): void {
    if (isIgnoredWorkspacePath(uri.fsPath)) {
      return;
    }
    this.queue = this.queue
      .then(async () => {
        const entries = await this.entries?.catch(() => undefined);
        if (!entries) {
          return;
        }
        const entry =
          removed || !(await this.isVisible(uri)) ? undefined : await this.readSafely(uri);
        if (entry === undefined) {
          entries.delete(uri.fsPath);
        } else {
          entries.set(uri.fsPath, entry);
        }
      })
      // A failing update must not stop the later ones.
      .catch((error: unknown) => {
        this.logger.warn(`Could not update the index for ${uri.fsPath}: ${String(error)}`);
      });
  }

  /** Whether `findFiles` (which applies `files.exclude`) still returns this one path. */
  private async isVisible(uri: vscode.Uri): Promise<boolean> {
    const name = path.basename(uri.fsPath).replace(/[\\*?{}[\]()!]/g, '[$&]');
    const found = await vscode.workspace.findFiles(
      new vscode.RelativePattern(path.dirname(uri.fsPath), name),
      undefined,
      1
    );
    return found.length > 0;
  }
}
