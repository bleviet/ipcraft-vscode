import * as path from 'path';
import type * as vscode from 'vscode';
import type { NormalizedBusLibrary } from '../shared/busContracts';
import type { Logger } from '../utils/Logger';
import type { ResourceRoots } from './ResourceRoots';
import { ImportResolver, type IpCoreDataNode } from './ImportResolver';

/** Load the same precedence-ordered runtime bus library used by the IP Core editor. */
export async function loadRuntimeBusLibrary(
  logger: Logger,
  resourceRoots: ResourceRoots,
  resourceUri: vscode.Uri,
  ipCoreData: IpCoreDataNode = {}
): Promise<NormalizedBusLibrary> {
  const resolver = new ImportResolver(
    logger,
    resourceRoots.busDefinitionsDir,
    resourceRoots.busDefinitionSchemaPath
  );
  const imports = await resolver.resolveImports(
    ipCoreData,
    path.dirname(resourceUri.fsPath),
    resourceUri
  );
  if (!imports.busLibrary) {
    throw new Error('Bus contract library could not be loaded.');
  }
  return imports.busLibrary;
}
