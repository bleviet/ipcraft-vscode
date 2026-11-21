/**
 * Finds the resource reports near a design file (a Vivado or Quartus project above it) or
 * below a folder the user chose. Extension side (reads the file system), no `vscode`.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { SystemGraph } from '../../domain/systemGraph';
import {
  oocCheckpointCandidate,
  oocReportFiles,
  runCheckpointCandidates,
} from './checkpointCandidates';
import { classifyReportFiles, type ReportCandidate } from './reportCandidates';

export type { ReportCandidate } from './reportCandidates';

/** How many folders above the design file are searched when there is no workspace folder to stop at. */
const MAX_LEVELS = 6;
/** How deep below a chosen folder reports are looked for. */
const MAX_DEPTH = 4;

async function listDir(dir: string): Promise<Array<{ name: string; isDir: boolean }>> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, isDir: entry.isDirectory() }));
  } catch {
    return [];
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch {
    return false;
  }
}

async function readText(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * A Vivado project: the reports of its run folders and of the per-IP out-of-context runs, and the
 * checkpoints that have no report (`storage` holds the reports extracted from them earlier).
 */
async function vivadoReports(
  xpr: string,
  graph: SystemGraph,
  searched: string[],
  storage: string | undefined
): Promise<ReportCandidate[]> {
  const runsDir = path.join(path.dirname(xpr), `${path.basename(xpr, '.xpr')}.runs`);
  const runs = await listDir(runsDir);
  if (runs.length === 0) {
    return [];
  }
  searched.push(runsDir);
  const found: ReportCandidate[] = [];
  for (const run of runs.filter((r) => r.isDir && !r.name.startsWith('.'))) {
    if (run.name.endsWith('_synth_1')) {
      continue;
    }
    const dir = path.join(runsDir, run.name);
    const files = (await listDir(dir))
      .filter((entry) => !entry.isDir && entry.name.endsWith('.rpt'))
      .map((entry) => path.join(dir, entry.name));
    const reports = await classifyReportFiles(files, graph, {
      refusals: 'relevant',
      detail: run.name,
    });
    found.push(
      ...reports,
      ...(await runCheckpointCandidates(dir, run.name, reports, graph, storage))
    );
  }
  const ooc = await oocReportFiles(
    runsDir,
    Object.values(graph.instances).map((instance) => instance.xciName),
    storage
  );
  if (ooc.files.length > 0) {
    const group = await classifyReportFiles(ooc.files, graph, {
      refusals: 'relevant',
      oocId: `ooc:${runsDir}`,
    });
    for (const candidate of group) {
      if (candidate.group === 'ooc' && ooc.missing.length > 0) {
        candidate.extract = ooc.missing;
      }
    }
    found.push(...group);
  } else if (ooc.missing.length > 0) {
    const ipCount = Object.values(graph.instances).filter((i) => i.xciName !== undefined).length;
    found.push(oocCheckpointCandidate(runsDir, ooc.missing, ipCount));
  }
  return found;
}

/** A Quartus project: the synthesis and fitter reports of its revision. */
async function quartusReports(
  qpf: string,
  graph: SystemGraph,
  searched: string[]
): Promise<ReportCandidate[]> {
  const projectDir = path.dirname(qpf);
  const revision =
    /^\s*PROJECT_REVISION\s*=\s*"?([^"\s]+)"?/m.exec((await readText(qpf)) ?? '')?.[1] ??
    path.basename(qpf, '.qpf');
  const qsf = (await readText(path.join(projectDir, `${revision}.qsf`))) ?? '';
  const outputName =
    /^\s*set_global_assignment\s+-name\s+PROJECT_OUTPUT_DIRECTORY\s+"?([^"\s]+)"?/m.exec(qsf)?.[1];
  const outputDir = outputName ? path.resolve(projectDir, outputName) : projectDir;
  if (!searched.includes(outputDir)) {
    searched.push(outputDir);
  }
  const files: string[] = [];
  for (const name of [`${revision}.map.rpt`, `${revision}.fit.rpt`, `${revision}.fit.summary`]) {
    const file = path.join(outputDir, name);
    if (await exists(file)) {
      files.push(file);
    }
  }
  return classifyReportFiles(files, graph, { refusals: 'relevant' });
}

/**
 * The reports of the Vivado and Quartus projects in the folders above `designFile`, up to
 * `stopAt` (the workspace folder) or at most {@link MAX_LEVELS} folders. `searched` lists
 * every folder looked in. `storage` is the extension's storage folder, where reports extracted
 * from checkpoints are kept.
 */
export async function discoverProjectReports(
  designFile: string,
  graph: SystemGraph,
  stopAt?: string,
  storage?: string
): Promise<{ candidates: ReportCandidate[]; searched: string[] }> {
  const searched: string[] = [];
  const byId = new Map<string, ReportCandidate>();
  const stop = stopAt === undefined ? undefined : path.resolve(stopAt);
  let dir = path.dirname(path.resolve(designFile));
  for (let level = 0; level < MAX_LEVELS; level++) {
    searched.push(dir);
    const names = (await listDir(dir)).filter((entry) => !entry.isDir).map((entry) => entry.name);
    const found: ReportCandidate[] = [];
    for (const name of names.filter((n) => n.endsWith('.xpr'))) {
      found.push(...(await vivadoReports(path.join(dir, name), graph, searched, storage)));
    }
    for (const name of names.filter((n) => n.endsWith('.qpf'))) {
      found.push(...(await quartusReports(path.join(dir, name), graph, searched)));
    }
    for (const candidate of found) {
      byId.set(candidate.id, candidate);
    }
    const parent = path.dirname(dir);
    if (dir === stop || parent === dir) {
      break;
    }
    dir = parent;
  }
  return { candidates: [...byId.values()], searched };
}

async function collectReportFiles(dir: string, depth: number, into: string[]): Promise<void> {
  for (const entry of await listDir(dir)) {
    const file = path.join(dir, entry.name);
    if (!entry.isDir) {
      if (entry.name.endsWith('.rpt') || entry.name.endsWith('.fit.summary')) {
        into.push(file);
      }
    } else if (depth < MAX_DEPTH && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      await collectReportFiles(file, depth + 1, into);
    }
  }
}

/**
 * Every report below `folder` (at most {@link MAX_DEPTH} levels), the per-IP OOC reports as one
 * candidate. Reports that cannot be used are listed with the reason.
 */
export async function discoverFolderReports(
  folder: string,
  graph: SystemGraph
): Promise<ReportCandidate[]> {
  const files: string[] = [];
  await collectReportFiles(path.resolve(folder), 0, files);
  return classifyReportFiles(files, graph, { refusals: 'all' });
}
