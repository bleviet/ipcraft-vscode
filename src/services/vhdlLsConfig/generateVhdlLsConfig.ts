/**
 * Orchestrates vhdl_ls.toml generation: walk, read manifests, scan VHDL, build the library
 * map, render, honour file ownership, back up, write. Shared by the CLI and the VS Code
 * command; no `vscode` import.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as toml from 'toml';
import { walkWorkspace, type WorkspaceFiles } from './workspaceWalk';
import {
  readComponentXml,
  readHwTcl,
  readIpYml,
  readQuartusAssignments,
  readXpr,
  type SourceReadResult,
} from './sourceReaders';
import { scanVhdl, type VhdlScan } from './vhdlUnitScanner';
import { buildLibraryMap, type Claim, type ClaimRank } from './buildLibraryMap';
import { parseUserSection, tomlErrorInfo, type UserLibrary } from './userSection';
import { appendProposals, renderVhdlLsToml } from './renderVhdlLsToml';
import { classifyExisting, normalizeEol, splitUserSection } from './ownership';
import { vendorFilesFor, type VendorFiles, type VendorInstalls } from './vendorLibraries';

export interface VhdlLsConfigOptions {
  root: string;
  force: boolean;
  dryRun: boolean;
  vendorInstalls?: VendorInstalls;
  now?: Date;
}

export interface VhdlLsConfigSummary {
  libraries: number;
  files: number;
  excludedFiles: number;
  missingLibraries: string[];
  skippedEntries: number;
  unscannedFiles: number;
}

export type VhdlLsConfigResult =
  | {
      status: 'written' | 'unchanged' | 'dryRun';
      configPath: string;
      text: string;
      summary: VhdlLsConfigSummary;
      backupPath?: string;
    }
  | { status: 'needsConfirmation'; configPath: string; ownership: 'edited' | 'user' }
  | { status: 'error'; configPath: string; message: string };

const MAX_SCAN_BYTES = 1024 * 1024;
const READ_CONCURRENCY = 8;

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

const toPosix = (p: string): string => p.split(path.sep).join('/');

interface ClaimsResult {
  claims: Claim[];
  skippedEntries: number;
}

/** True for a relative path that stays inside its base (not `..`, `../x` or absolute). */
function isInside(rel: string): boolean {
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

async function collectClaims(root: string, walk: WorkspaceFiles): Promise<ClaimsResult> {
  const realRoot = await fs.realpath(root);
  const sources: {
    files: string[];
    rank: ClaimRank;
    read: (file: string) => Promise<SourceReadResult>;
  }[] = [
    { files: walk.xpr, rank: 1, read: (f) => textReader(f, readXpr) },
    { files: walk.qsf, rank: 1, read: (f) => textReader(f, readQuartusAssignments) },
    { files: walk.qip, rank: 1, read: (f) => textReader(f, readQuartusAssignments) },
    { files: walk.componentXml, rank: 2, read: (f) => textReader(f, readComponentXml) },
    { files: walk.hwTcl, rank: 3, read: readHwTcl },
    { files: walk.ipYml, rank: 4, read: (f) => textReader(f, readIpYml) },
  ];
  const claims: Claim[] = [];
  let skippedEntries = 0;
  for (const { files, rank, read } of sources) {
    const results = await mapPool(files, READ_CONCURRENCY, async (file) => {
      const result = await read(file);
      const entries = await mapPool(result.entries, READ_CONCURRENCY, async (entry) => {
        const rel = path.relative(root, entry.file);
        if (!isInside(rel) || walk.isExcluded(entry.file)) {
          return undefined;
        }
        // The lexical check cannot see symlinked directories that lead outside the root.
        const real = await fs.realpath(entry.file).catch(() => undefined);
        if (real === undefined || !isInside(path.relative(realRoot, real))) {
          return undefined;
        }
        const isFile = await fs.stat(real).then(
          (s) => s.isFile(),
          () => false
        );
        return isFile ? { entry, rel } : undefined;
      });
      return { file, result, entries };
    });
    for (const { file, result, entries } of results) {
      skippedEntries += result.unresolved;
      for (const found of entries) {
        if (!found) {
          skippedEntries++;
          continue;
        }
        claims.push({
          file: toPosix(found.rel),
          rank,
          library: found.entry.library,
          source: toPosix(path.relative(root, file)),
        });
      }
    }
  }
  return { claims, skippedEntries };
}

async function textReader(
  file: string,
  read: (text: string, filePath: string) => SourceReadResult
): Promise<SourceReadResult> {
  const text = await readText(file);
  return text === undefined ? { entries: [], unresolved: 1 } : read(text, file);
}

async function scanFiles(
  root: string,
  files: string[]
): Promise<{ scans: Map<string, VhdlScan | undefined>; unscanned: number }> {
  const scans = new Map<string, VhdlScan | undefined>();
  let unscanned = 0;
  await mapPool(files, READ_CONCURRENCY, async (rel) => {
    const abs = path.join(root, ...rel.split('/'));
    try {
      const size = (await fs.stat(abs)).size;
      if (size > MAX_SCAN_BYTES) {
        unscanned++;
        scans.set(rel, undefined);
        return;
      }
      scans.set(rel, scanVhdl(await fs.readFile(abs, 'utf8')));
    } catch {
      unscanned++;
      scans.set(rel, undefined);
    }
  });
  return { scans, unscanned };
}

function backupName(now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d+Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-');
  return `vhdl_ls.${stamp}.toml`;
}

const lineCount = (text: string): number => text.split('\n').length - 1;

export async function generateVhdlLsConfig(
  options: VhdlLsConfigOptions
): Promise<VhdlLsConfigResult> {
  const root = path.resolve(options.root);
  const configPath = path.join(root, 'vhdl_ls.toml');
  try {
    const existing = await readText(configPath);
    const ownership = classifyExisting(existing);
    if ((ownership === 'edited' || ownership === 'user') && !options.force && !options.dryRun) {
      return { status: 'needsConfirmation', configPath, ownership };
    }

    const name = backupName(options.now ?? new Date());
    let userText = '';
    let userLibraries: UserLibrary[] = [];
    let proposed: ReadonlySet<string> = new Set();
    if (ownership === 'owned') {
      userText = splitUserSection(existing as string);
    } else if (ownership === 'edited' || ownership === 'user') {
      userText = `# Previous vhdl_ls.toml saved to .ipcraft/backup/${name}\n`;
    }
    if (ownership === 'owned' || ownership === 'none') {
      const parsed = parseUserSection(userText);
      if (!parsed.ok) {
        const existingLf = normalizeEol(existing ?? '');
        const lineOffset = lineCount(existingLf.slice(0, existingLf.length - userText.length));
        return {
          status: 'error',
          configPath,
          message: `The user section of vhdl_ls.toml is not valid TOML (line ${parsed.line + lineOffset}): ${parsed.message}`,
        };
      }
      userLibraries = parsed.section.libraries;
      proposed = parsed.section.proposedLibraries;
    }

    const walk = await walkWorkspace(root);
    const { claims, skippedEntries } = await collectClaims(root, walk);
    const vhdlFiles = [
      ...new Set([
        ...walk.vhdl.map((f) => toPosix(path.relative(root, f))),
        ...claims.map((c) => c.file),
      ]),
    ];
    const { scans, unscanned } = await scanFiles(root, vhdlFiles);
    const map = buildLibraryMap({ claims, vhdlFiles, scans, userLibraries });

    const vendorFiles = new Map<string, VendorFiles>();
    for (const missing of map.missing) {
      const found = vendorFilesFor(missing.name, options.vendorInstalls ?? {});
      if (found) {
        vendorFiles.set(missing.name, found);
      }
    }
    const finalUserText = appendProposals(userText, map.missing, proposed, vendorFiles);
    const text = renderVhdlLsToml(map.libraries, finalUserText);
    try {
      toml.parse(text);
    } catch (err) {
      const info = tomlErrorInfo(err);
      return {
        status: 'error',
        configPath,
        message: `Generated vhdl_ls.toml is not valid TOML (line ${info.line}): ${info.message}`,
      };
    }

    const summary: VhdlLsConfigSummary = {
      libraries: map.libraries.length,
      files: map.libraries.reduce((n, l) => n + l.files.length, 0),
      excludedFiles: map.libraries.reduce((n, l) => n + l.excluded.length, 0),
      missingLibraries: map.missing.map((m) => m.name),
      skippedEntries,
      unscannedFiles: unscanned,
    };
    if (options.dryRun) {
      return { status: 'dryRun', configPath, text, summary };
    }
    if (existing === text) {
      return { status: 'unchanged', configPath, text, summary };
    }
    let backupPath: string | undefined;
    if (existing !== undefined && (ownership === 'edited' || ownership === 'user')) {
      backupPath = path.join(root, '.ipcraft', 'backup', name);
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.writeFile(backupPath, existing, 'utf8');
    }
    await fs.writeFile(configPath, text, 'utf8');
    return { status: 'written', configPath, text, summary, backupPath };
  } catch (err) {
    return {
      status: 'error',
      configPath,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
