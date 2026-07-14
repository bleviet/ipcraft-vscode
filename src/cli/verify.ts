import * as fs from 'fs/promises';
import * as path from 'path';
import type { ResourceRoots } from '../services/ResourceRoots';
import { listAll } from '../services/toolchains/registry';
import { buildCliScaffolder, buildGenerateOptions } from './generate';
import type { CliGenerateArgs } from './generate';

export interface CliVerifyArgs extends CliGenerateArgs {
  generatedDir: string;
}

export interface CliVerifyResult {
  success: boolean;
  error?: string;
  /**
   * Relative paths (to generatedDir), sorted, that differ from a fresh generation, are
   * missing, or are orphaned (on disk in a generated directory but no longer produced by a
   * fresh generation, e.g. after a scaffold_pack or --target change).
   */
  staleFiles?: string[];
}

/**
 * Recursively lists every file under `dir` (relative to `dir`, forward-slash separated to
 * match the pack-template-derived keys in `generatedContents`). Returns an empty list if
 * `dir` doesn't exist — there's nothing orphaned in a directory that was never generated
 * into.
 */
async function listFilesRecursive(dir: string, relPrefix = ''): Promise<string[]> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(path.join(dir, entry.name), relPath)));
    } else if (entry.isFile()) {
      files.push(relPath);
    }
  }
  return files;
}

/**
 * Core logic behind `ipcraft verify` (issue #73) — regenerates the same .ip.yml in memory
 * (IpCoreScaffolder's dryRun mode) and diffs the result against what's actually on disk in
 * generatedDir, so drift between an edited .ip.yml and stale committed output is caught as a
 * tooling guarantee rather than a review-discipline problem.
 *
 * managed:false files are exempt: IPCraft never (re)generates them, so they can't go stale
 * relative to a fresh generation by definition.
 *
 * Beyond the forward diff (generated -> disk), also reverse-scans every top-level directory
 * IPCraft could generate into (e.g. rtl/, tb/, altera/, xilinx/) for files no longer part of
 * a fresh generation — e.g. after switching scaffold_pack or dropping a --target — so those
 * don't sit on disk invisibly. Which directories to walk is deliberately computed from a
 * second, target-superset dry run rather than from `result.generatedContents` alone: dropping
 * `--target quartus` makes every altera/ path vanish from the *current* args' generatedContents,
 * so scoping the walk to that would mean stale altera/ files silently go unnoticed — the exact
 * drift `verify` exists to catch. Staleness itself is still judged against the real
 * (current-args) generatedContents; the superset run only decides where to look.
 */
export async function runCliVerify(
  args: CliVerifyArgs,
  resourceRoots: ResourceRoots
): Promise<CliVerifyResult> {
  const scaffolder = buildCliScaffolder(resourceRoots);

  const resolvedIpYaml = path.resolve(args.ipYamlPath);
  const generatedDir = path.resolve(args.generatedDir);

  const result = await scaffolder.generateAll(resolvedIpYaml, generatedDir, {
    ...buildGenerateOptions(args),
    dryRun: true,
  });

  if (!result.success || !result.generatedContents) {
    return { success: false, error: result.error };
  }

  const protectedPaths = new Set(result.protectedPaths ?? []);
  const staleFiles = new Set<string>();

  for (const [relPath, freshContent] of Object.entries(result.generatedContents)) {
    if (protectedPaths.has(relPath)) {
      continue;
    }
    const diskPath = path.join(generatedDir, relPath);
    let onDiskContent: string;
    try {
      onDiskContent = await fs.readFile(diskPath, 'utf8');
    } catch {
      staleFiles.add(relPath);
      continue;
    }
    if (onDiskContent !== freshContent) {
      staleFiles.add(relPath);
    }
  }

  const userManagedPaths = new Set(result.userManagedPaths ?? []);

  const allTargetIds = listAll().map((t) => t.id);
  const unionResult = await scaffolder.generateAll(resolvedIpYaml, generatedDir, {
    ...buildGenerateOptions({ ...args, targets: allTargetIds }),
    dryRun: true,
  });
  const dirScanSource =
    unionResult.success && unionResult.generatedContents
      ? unionResult.generatedContents
      : result.generatedContents;

  const generatedTopLevelDirs = new Set(
    Object.keys(dirScanSource)
      .filter((p) => p.includes('/'))
      .map((p) => p.split('/')[0])
  );
  for (const topDir of generatedTopLevelDirs) {
    const filesOnDisk = await listFilesRecursive(path.join(generatedDir, topDir), topDir);
    for (const relPath of filesOnDisk) {
      if (!(relPath in result.generatedContents) && !userManagedPaths.has(relPath)) {
        staleFiles.add(relPath);
      }
    }
  }

  const sortedStaleFiles = [...staleFiles].sort();
  return { success: sortedStaleFiles.length === 0, staleFiles: sortedStaleFiles };
}
