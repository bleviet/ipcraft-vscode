import * as path from 'path';
import * as vscode from 'vscode';
import type { NormalizedBusLibrary } from '../shared/busContracts';
import { Logger } from '../utils/Logger';
import type { ResourceRoots } from './ResourceRoots';
import { ImportResolver, type IpCoreDataNode } from './ImportResolver';

// Callers are one-shot commands without a shared owner, so keep one long-lived
// resolver per bus definitions directory to retain its caches across calls.
const runtimeResolvers = new Map<string, ImportResolver>();

// Set once registerRuntimeBusLibraryInvalidation runs; roots seen before are ignored.
let extensionContext: vscode.ExtensionContext | undefined;
const watchedRoots = new Set<string>();

/** Watch a definition root outside the workspace folders (the global watcher misses it). */
function watchOutOfWorkspaceRoot(root: string): void {
  if (!extensionContext || watchedRoots.has(root)) {
    return;
  }
  const folders = vscode.workspace.workspaceFolders ?? [];
  const inWorkspace = folders.some((folder) => {
    const rel = path.relative(folder.uri.fsPath, root);
    return !rel.startsWith('..') && !path.isAbsolute(rel);
  });
  if (inWorkspace) {
    return;
  }
  watchedRoots.add(root);
  const isFile = /\.ya?ml$/.test(root);
  const pattern = isFile
    ? new vscode.RelativePattern(vscode.Uri.file(path.dirname(root)), path.basename(root))
    : new vscode.RelativePattern(vscode.Uri.file(root), '**/*.{yml,yaml}');
  const watcher = vscode.workspace.createFileSystemWatcher(pattern);
  watcher.onDidCreate(clearRuntimeBusDefinitionFileCaches);
  watcher.onDidChange(clearRuntimeBusDefinitionFileCaches);
  watcher.onDidDelete(clearRuntimeBusDefinitionFileCaches);
  extensionContext.subscriptions.push(watcher);
}

export function getRuntimeImportResolver(resourceRoots: ResourceRoots): ImportResolver {
  let resolver = runtimeResolvers.get(resourceRoots.busDefinitionsDir);
  if (!resolver) {
    resolver = new ImportResolver(
      new Logger('RuntimeBusLibrary'),
      resourceRoots.busDefinitionsDir,
      resourceRoots.busDefinitionSchemaPath,
      watchOutOfWorkspaceRoot
    );
    runtimeResolvers.set(resourceRoots.busDefinitionsDir, resolver);
  }
  return resolver;
}

/** Drop cached bus definition files on every shared resolver (workspace scan is kept). */
export function clearRuntimeBusDefinitionFileCaches(): void {
  for (const resolver of runtimeResolvers.values()) {
    resolver.clearDefinitionFileCache();
  }
}

/** Invalidate the shared bus library caches when non-IPCraft YAML files change. */
export function registerRuntimeBusLibraryInvalidation(context: vscode.ExtensionContext): void {
  extensionContext = context;
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{yml,yaml}');
  const invalidate = (uri: vscode.Uri): void => {
    if (/\.(ip|mm)\.yml$/.test(uri.fsPath)) {
      return;
    }
    clearRuntimeBusDefinitionFileCaches();
  };
  watcher.onDidCreate(invalidate);
  watcher.onDidChange(invalidate);
  watcher.onDidDelete(invalidate);
  context.subscriptions.push(watcher);
}

/** Load the same precedence-ordered runtime bus library used by the IP Core editor. */
export async function loadRuntimeBusLibrary(
  resourceRoots: ResourceRoots,
  resourceUri: vscode.Uri,
  ipCoreData: IpCoreDataNode = {}
): Promise<NormalizedBusLibrary> {
  return getRuntimeImportResolver(resourceRoots).loadBusLibrary(
    ipCoreData,
    path.dirname(resourceUri.fsPath),
    resourceUri
  );
}
