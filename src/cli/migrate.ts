import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'yaml';
import {
  migrateIpCoreYaml,
  migrateMemoryMapYaml,
  type IpCoreFormatVersion,
} from '../shared/ipCoreFormat';
import { normalizeMemoryMap } from '../domain/parse';
import { resolveMemoryMapImports } from '../services/imports/resolveMemoryMapImports';
import { loadRuntimeBusLibrary } from '../services/loadRuntimeBusLibrary';
import type { IpCoreDataNode } from '../services/ImportResolver';
import type { ResourceRoots } from '../services/ResourceRoots';
import { Logger } from '../utils/Logger';

export interface CliMigrateArgs {
  paths: string[];
  /** Report files that need an upgrade without writing anything. */
  check: boolean;
}

/** Format versions are only reported for `.ip.yml`; `.mm.yml` files have no `apiVersion`. */
export type CliMigrateFileResult =
  | {
      path: string;
      status: 'upgraded';
      fromVersion?: IpCoreFormatVersion;
      toVersion?: IpCoreFormatVersion;
      mutationCount: number;
    }
  | {
      path: string;
      status: 'needsUpgrade';
      fromVersion?: IpCoreFormatVersion;
      toVersion?: IpCoreFormatVersion;
    }
  | { path: string; status: 'upToDate'; version?: IpCoreFormatVersion }
  | { path: string; status: 'error'; error: string };

function isMemoryMapPath(filePath: string): boolean {
  return filePath.toLowerCase().endsWith('.mm.yml') || filePath.toLowerCase().endsWith('.mm.yaml');
}

/** Convert legacy keys in a `.mm.yml` file; no bus library is needed. */
async function migrateMemoryMapFile(
  filePath: string,
  check: boolean
): Promise<CliMigrateFileResult> {
  const absolutePath = path.resolve(filePath);
  const text = await fs.readFile(absolutePath, 'utf-8');
  const result = migrateMemoryMapYaml(text);
  if (!result.changed) {
    return { path: filePath, status: 'upToDate' };
  }
  if (check) {
    return { path: filePath, status: 'needsUpgrade' };
  }
  await fs.writeFile(absolutePath, result.text, 'utf-8');
  return { path: filePath, status: 'upgraded', mutationCount: result.mutationCount };
}

async function migrateFile(
  filePath: string,
  check: boolean,
  logger: Logger,
  resourceRoots: ResourceRoots
): Promise<CliMigrateFileResult> {
  const absolutePath = path.resolve(filePath);
  const text = await fs.readFile(absolutePath, 'utf-8');
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
  if (!result.changed) {
    return { path: filePath, status: 'upToDate', version: result.toVersion };
  }
  const { fromVersion, toVersion, mutationCount } = result;
  if (check) {
    return { path: filePath, status: 'needsUpgrade', fromVersion, toVersion };
  }
  await fs.writeFile(absolutePath, result.text, 'utf-8');
  return { path: filePath, status: 'upgraded', fromVersion, toVersion, mutationCount };
}

/**
 * Core logic behind `ipcraft migrate`: upgrades each `.ip.yml` file to the latest format
 * version and converts legacy keys in `.ip.yml` and `.mm.yml` files. A file that cannot be
 * read, parsed, or declares a newer version is reported as an error result; the remaining
 * files are still processed.
 */
export async function runCliMigrate(
  args: CliMigrateArgs,
  resourceRoots: ResourceRoots
): Promise<CliMigrateFileResult[]> {
  const logger = new Logger('ipcraft-cli');
  const results: CliMigrateFileResult[] = [];
  for (const filePath of args.paths) {
    try {
      results.push(
        isMemoryMapPath(filePath)
          ? await migrateMemoryMapFile(filePath, args.check)
          : await migrateFile(filePath, args.check, logger, resourceRoots)
      );
    } catch (err) {
      results.push({
        path: filePath,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}
