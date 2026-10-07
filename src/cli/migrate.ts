import * as fs from 'fs/promises';
import * as path from 'path';
import type { IpCoreFormatVersion } from '../shared/ipCoreFormat';
import { migrateSpecText } from '../services/migrateSpecText';
import type { ResourceRoots } from '../services/ResourceRoots';

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

async function migrateFile(
  filePath: string,
  check: boolean,
  resourceRoots: ResourceRoots
): Promise<CliMigrateFileResult> {
  const absolutePath = path.resolve(filePath);
  const text = await fs.readFile(absolutePath, 'utf-8');
  const migration = await migrateSpecText(absolutePath, text, resourceRoots);
  const { result } = migration;
  if (!result.changed) {
    return migration.kind === 'memoryMap'
      ? { path: filePath, status: 'upToDate' }
      : { path: filePath, status: 'upToDate', version: migration.result.toVersion };
  }
  const versions =
    migration.kind === 'ipCore'
      ? { fromVersion: migration.result.fromVersion, toVersion: migration.result.toVersion }
      : {};
  if (check) {
    return { path: filePath, status: 'needsUpgrade', ...versions };
  }
  await fs.writeFile(absolutePath, result.text, 'utf-8');
  return { path: filePath, status: 'upgraded', ...versions, mutationCount: result.mutationCount };
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
  const results: CliMigrateFileResult[] = [];
  for (const filePath of args.paths) {
    try {
      results.push(await migrateFile(filePath, args.check, resourceRoots));
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
