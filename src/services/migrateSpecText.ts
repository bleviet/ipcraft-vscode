import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'yaml';
import {
  migrateIpCoreYaml,
  migrateMemoryMapYaml,
  type IpCoreMigrationResult,
  type MemoryMapMigrationResult,
} from '../shared/ipCoreFormat';
import { normalizeMemoryMap } from '../domain/parse';
import { resolveMemoryMapImports } from './imports/resolveMemoryMapImports';
import { loadRuntimeBusLibrary } from './loadRuntimeBusLibrary';
import type { IpCoreDataNode } from './ImportResolver';
import type { ResourceRoots } from './ResourceRoots';

export type SpecMigration =
  | { kind: 'memoryMap'; result: MemoryMapMigrationResult }
  | { kind: 'ipCore'; result: IpCoreMigrationResult };

export function isMemoryMapPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.mm.yml') || filePath.toLowerCase().endsWith('.mm.yaml');
}

/**
 * Migrate the text of one spec file; shared by `ipcraft migrate` and the VS Code command.
 * `.mm.yml` files only need legacy key renames; `.ip.yml` files also load the bus library
 * and the imported memory map names (for the dangling `memoryMapRef` repair).
 */
export async function migrateSpecText(
  absolutePath: string,
  text: string,
  resourceRoots: ResourceRoots
): Promise<SpecMigration> {
  if (isMemoryMapPath(absolutePath)) {
    return { kind: 'memoryMap', result: migrateMemoryMapYaml(text) };
  }

  const ipCoreData = yaml.parse(text) as unknown;
  if (!ipCoreData || typeof ipCoreData !== 'object' || Array.isArray(ipCoreData)) {
    throw new Error('Invalid YAML: must be an object');
  }

  const library = await loadRuntimeBusLibrary(
    resourceRoots,
    vscode.Uri.file(absolutePath),
    ipCoreData as IpCoreDataNode
  );
  // A failed import leaves the set of map names unknown, so skip the ref repair entirely.
  const { resolved, errors } = await resolveMemoryMapImports({
    memoryMaps: (ipCoreData as Record<string, unknown>).memoryMaps,
    baseDir: path.dirname(absolutePath),
    reader: { readText: (absPath) => fs.readFile(absPath, 'utf8') },
  });
  const result = migrateIpCoreYaml(
    text,
    library,
    errors.length > 0 ? undefined : resolved.map((rawMap) => normalizeMemoryMap(rawMap).name)
  );
  return { kind: 'ipCore', result };
}
