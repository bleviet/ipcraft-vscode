import * as fs from 'fs/promises';
import * as path from 'path';
import type { ResourceRoots } from '../services/ResourceRoots';
import { buildCliScaffolder, buildGenerateOptions } from './generate';
import type { CliGenerateArgs } from './generate';

export interface CliVerifyArgs extends CliGenerateArgs {
  generatedDir: string;
}

export interface CliVerifyResult {
  success: boolean;
  error?: string;
  /** Relative paths (to generatedDir), sorted, that differ from a fresh generation or are missing. */
  staleFiles?: string[];
}

/**
 * Core logic behind `ipcraft verify` (issue #73) — regenerates the same .ip.yml in memory
 * (IpCoreScaffolder's dryRun mode) and diffs the result against what's actually on disk in
 * generatedDir, so drift between an edited .ip.yml and stale committed output is caught as a
 * tooling guarantee rather than a review-discipline problem.
 *
 * managed:false files are exempt: IPCraft never (re)generates them, so they can't go stale
 * relative to a fresh generation by definition.
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
  const staleFiles: string[] = [];

  for (const [relPath, freshContent] of Object.entries(result.generatedContents)) {
    if (protectedPaths.has(relPath)) {
      continue;
    }
    const diskPath = path.join(generatedDir, relPath);
    let onDiskContent: string;
    try {
      onDiskContent = await fs.readFile(diskPath, 'utf8');
    } catch {
      staleFiles.push(relPath);
      continue;
    }
    if (onDiskContent !== freshContent) {
      staleFiles.push(relPath);
    }
  }

  staleFiles.sort();
  return { success: staleFiles.length === 0, staleFiles };
}
