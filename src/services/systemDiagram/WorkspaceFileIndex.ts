/**
 * Lazily built, in-memory index of workspace files matching a glob. After the
 * first build a file watcher (created once) updates the index for the changed
 * file only. Files are read with a small concurrent pool.
 */

import * as path from 'path';
import * as vscode from 'vscode';
import type { Logger } from '../../utils/Logger';
import { buildExcludeGlob } from './enrichment/excludeGlob';
import { isIgnoredWorkspacePath } from './enrichment/workspaceFilter';

const READ_POOL_SIZE = 8;

export class WorkspaceFileIndex<T> {
  private entries?: Promise<Map<string, T>>;
  private watching = false;
  private disposables: vscode.Disposable[] = [];
  private queue: Promise<void> = Promise.resolve();
  private readonly warnedPatterns = new Set<string>();
  private changes = 0;

  constructor(
    private readonly glob: string,
    private readonly limit: number,
    /** Reads one file into an entry; undefined skips it. */
    private readonly read: (uri: vscode.Uri) => Promise<T | undefined>,
    private readonly logger: Logger
  ) {}

  /**
   * Counts the moments the content may change: a watcher event, the end of its update, and a
   * dropped cache. A result read from the index while this changed is not current.
   */
  get revision(): number {
    return this.changes;
  }

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
    this.changes++;
  }

  private async build(): Promise<Map<string, T>> {
    const found = await vscode.workspace.findFiles(this.glob, this.excludeGlob(), this.limit);
    if (found.length >= this.limit) {
      this.logger.warn(
        `The workspace search for ${this.glob} reached its limit of ${this.limit} files; later files are not indexed.`
      );
    }
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
      // A changed exclude changes what a build finds: drop the cache so the next get() rebuilds.
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('files.exclude') ||
          event.affectsConfiguration('search.exclude')
        ) {
          this.entries = undefined;
          this.changes++;
        }
      }),
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
    // Before the update is queued, so an enrichment that runs meanwhile is not taken as current.
    this.changes++;
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
      })
      .then(() => {
        this.changes++;
      });
  }

  /** The ignored directories plus `search.exclude`; VS Code adds `files.exclude` itself. */
  private excludeGlob(): string {
    const read = (section: string) =>
      vscode.workspace.getConfiguration(section).get<Record<string, unknown>>('exclude');
    const { glob, skipped } = buildExcludeGlob(read('search'));
    for (const pattern of skipped) {
      if (!this.warnedPatterns.has(pattern)) {
        this.warnedPatterns.add(pattern);
        this.logger.warn(
          `Ignoring the exclude pattern ${pattern}: its braces cannot be expanded (nested, unbalanced or stray).`
        );
      }
    }
    return glob;
  }

  /**
   * Whether `findFiles` (which applies the exclude) still returns this one path.
   * The pattern is relative to the workspace folder so directory excludes match;
   * outside any folder it falls back to the file's own directory. `!` is not
   * escaped (a class escape misparses); a top-level file whose name starts with
   * `!` is a known limit.
   */
  private async isVisible(uri: vscode.Uri): Promise<boolean> {
    const escape = (text: string) => text.replace(/[\\*?{}[\]()]/g, '[$&]');
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const pattern = folder
      ? new vscode.RelativePattern(
          folder,
          path.relative(folder.uri.fsPath, uri.fsPath).split(path.sep).map(escape).join('/')
        )
      : new vscode.RelativePattern(path.dirname(uri.fsPath), escape(path.basename(uri.fsPath)));
    const found = await vscode.workspace.findFiles(pattern, this.excludeGlob(), 1);
    return found.length > 0;
  }
}
