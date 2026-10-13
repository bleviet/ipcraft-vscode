import * as vscode from 'vscode';
import { isDeepStrictEqual } from 'util';
import { Logger } from '../../utils/Logger';
import type { VersionContext } from '../../shared/versioning/versionContext';
import { resolveVersionContext, type IpCoreCandidate } from './OwningIpCoreResolver';

const IP_CORE_GLOB = '**/*.ip.yml';
const DEBOUNCE_MS = 200;

const logger = new Logger('VersionContextWatcher');

/** The open document's text (unsaved edits count), else the file on disk; undefined if unreadable. */
async function readIpCoreText(uri: vscode.Uri): Promise<string | undefined> {
  const key = uri.toString();
  const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === key);
  if (open) {
    return open.getText();
  }
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/** Resolves the version context of a `.mm.yml` from every `.ip.yml` in the workspace. */
export async function readVersionContext(mmUri: vscode.Uri): Promise<VersionContext> {
  const uris = await vscode.workspace.findFiles(IP_CORE_GLOB, '**/node_modules/**');
  const read = await Promise.all(
    uris.map(async (uri): Promise<IpCoreCandidate | null> => {
      const text = await readIpCoreText(uri);
      return text === undefined
        ? null
        : { fsPath: uri.fsPath, relPath: vscode.workspace.asRelativePath(uri, false), text };
    })
  );
  return resolveVersionContext(
    mmUri.fsPath,
    read.filter((candidate): candidate is IpCoreCandidate => candidate !== null)
  );
}

/**
 * Posts the version context of `document` now, and again whenever an `.ip.yml` edit, save, or
 * file create/change/delete changes it. Bursts are debounced; an unchanged context is not re-sent.
 */
export function watchVersionContext(
  document: vscode.TextDocument,
  post: (context: VersionContext) => void
): vscode.Disposable {
  let last: VersionContext | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let latestRun = 0;

  const refresh = async (): Promise<void> => {
    const run = ++latestRun;
    const context = await readVersionContext(document.uri);
    if (disposed || run !== latestRun || (last !== undefined && isDeepStrictEqual(last, context))) {
      return;
    }
    last = context;
    post(context);
  };
  const runRefresh = (): void => {
    refresh().catch((err: unknown) => {
      logger.error('Failed to resolve the version context', err as Error);
    });
  };
  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(runRefresh, DEBOUNCE_MS);
  };
  const onIpCoreDocument = (changed: vscode.TextDocument): void => {
    if (changed.uri.fsPath.endsWith('.ip.yml')) {
      schedule();
    }
  };

  const fileWatcher = vscode.workspace.createFileSystemWatcher(IP_CORE_GLOB);
  const subscriptions: vscode.Disposable[] = [
    vscode.workspace.onDidChangeTextDocument((event) => {
      onIpCoreDocument(event.document);
    }),
    vscode.workspace.onDidSaveTextDocument(onIpCoreDocument),
    fileWatcher.onDidCreate(schedule),
    fileWatcher.onDidChange(schedule),
    fileWatcher.onDidDelete(schedule),
    fileWatcher,
  ];

  runRefresh();

  return {
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
      subscriptions.forEach((subscription) => {
        subscription.dispose();
      });
    },
  };
}
