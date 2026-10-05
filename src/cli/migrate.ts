import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import * as yaml from 'yaml';
import { migrateIpCoreYaml, type IpCoreFormatVersion } from '../shared/ipCoreFormat';
import { loadRuntimeBusLibrary } from '../services/loadRuntimeBusLibrary';
import type { IpCoreDataNode } from '../services/ImportResolver';
import type { ResourceRoots } from '../services/ResourceRoots';
import { Logger } from '../utils/Logger';

export interface CliMigrateArgs {
  paths: string[];
  /** Report files that need an upgrade without writing anything. */
  check: boolean;
}

export type CliMigrateFileResult =
  | {
      path: string;
      status: 'upgraded';
      fromVersion: IpCoreFormatVersion;
      toVersion: IpCoreFormatVersion;
      mutationCount: number;
    }
  | {
      path: string;
      status: 'needsUpgrade';
      fromVersion: IpCoreFormatVersion;
      toVersion: IpCoreFormatVersion;
    }
  | { path: string; status: 'upToDate'; version: IpCoreFormatVersion }
  | { path: string; status: 'error'; error: string };

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
  const result = migrateIpCoreYaml(text, library);
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
 * Core logic behind `ipcraft migrate`: upgrades each file to the latest `.ip.yml` format
 * version. A file that cannot be read, parsed, or declares a newer version is reported as an
 * error result; the remaining files are still processed.
 */
export async function runCliMigrate(
  args: CliMigrateArgs,
  resourceRoots: ResourceRoots
): Promise<CliMigrateFileResult[]> {
  const logger = new Logger('ipcraft-cli');
  const results: CliMigrateFileResult[] = [];
  for (const filePath of args.paths) {
    try {
      results.push(await migrateFile(filePath, args.check, logger, resourceRoots));
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
