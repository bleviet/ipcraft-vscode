/**
 * The Vivado checkpoints of a project as sources for the resource view: a checkpoint that has no
 * report of its stage next to it is offered for extraction, or listed as the report extracted
 * from it earlier. Extension side (reads files), no `vscode`.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { ResourceStage } from '../../domain/resourceUsage';
import type { SystemGraph } from '../../domain/systemGraph';
import {
  cachedReports,
  FLAT_REPORT,
  HIERARCHICAL_REPORT,
  isPlainName,
  oocReportName,
} from './extractionCache';
import {
  classifyReportFiles,
  stageLabel,
  type ExtractTarget,
  type ReportCandidate,
} from './reportCandidates';

export const CHECKPOINT_REASON =
  'Extract the report from the checkpoint. This runs Vivado, about a minute for a small design.';

/** A checkpoint that is not extracted yet: not usable, but offered for extraction. */
export function checkpointCandidate(
  dcp: string,
  label: string,
  stage?: ResourceStage
): ReportCandidate {
  return {
    id: dcp,
    group: 'checkpoint',
    vendor: 'vivado',
    ...(stage && { stage }),
    label,
    files: [dcp],
    recognition: { recognized: false, reason: 'unknown', message: CHECKPOINT_REASON },
    usable: false,
    reason: CHECKPOINT_REASON,
    extract: [{ dcp }],
  };
}

/** The reports a checkpoint was extracted into earlier, as the usable candidates they are. */
export async function extractedCandidates(
  storage: string | undefined,
  dcp: string,
  graph: SystemGraph,
  detail: string
): Promise<ReportCandidate[]> {
  const files =
    storage === undefined
      ? undefined
      : await cachedReports(storage, dcp, [HIERARCHICAL_REPORT, FLAT_REPORT]);
  if (!files) {
    return [];
  }
  const found = await classifyReportFiles(files, graph, { refusals: 'relevant', detail });
  return found
    .filter((candidate) => candidate.usable)
    .map((candidate) => ({ ...candidate, checkpoint: dcp }));
}

/** The implementation checkpoints worth extracting, the most refined first (`impl_1/<top>_routed.dcp`). */
const IMPL_STAGES: Array<{ stage: ResourceStage; suffix: string }> = [
  { stage: 'routed', suffix: 'routed' },
  { stage: 'placed', suffix: 'placed' },
];

/**
 * The checkpoint candidates of one run folder: `<top>.dcp` of a synthesis run, `<top>_routed.dcp`
 * (else `<top>_placed.dcp`) of an implementation run. `reports` are the candidates of the folder.
 */
export async function runCheckpointCandidates(
  dir: string,
  runName: string,
  reports: ReportCandidate[],
  graph: SystemGraph,
  storage: string | undefined
): Promise<ReportCandidate[]> {
  const names = (await fs.readdir(dir).catch(() => [] as string[])).sort();
  const dcps = names.filter((name) => name.endsWith('.dcp'));
  const top = names
    .map((name) => /^(.+?)_utilization_(?:synth|placed|routed)\.rpt$/.exec(name)?.[1])
    .find((name) => name !== undefined);
  const picks: Array<{ stage: ResourceStage; file: string | undefined }> = [];
  if (runName.startsWith('synth')) {
    picks.push({
      stage: 'synth',
      file: dcps.find((name) => top !== undefined && name === `${top}.dcp`) ?? dcps[0],
    });
  } else if (runName.startsWith('impl')) {
    for (const { stage, suffix } of IMPL_STAGES) {
      const file =
        dcps.find((name) => top !== undefined && name === `${top}_${suffix}.dcp`) ??
        dcps.find((name) => name.endsWith(`_${suffix}.dcp`));
      if (file) {
        picks.push({ stage, file });
        break;
      }
    }
  }

  const found: ReportCandidate[] = [];
  for (const { stage, file } of picks) {
    const usableOfStage = reports.some(
      (candidate) =>
        candidate.usable && candidate.stage === stage && path.dirname(candidate.files[0]) === dir
    );
    if (!file || usableOfStage) {
      continue;
    }
    const dcp = path.join(dir, file);
    const extracted = await extractedCandidates(storage, dcp, graph, runName);
    found.push(
      ...(extracted.length > 0
        ? extracted
        : [checkpointCandidate(dcp, `${stageLabel('vivado', stage)} (${runName})`, stage)])
    );
  }
  return found;
}

/** Every IP of the project was an IP cache hit: no report to list, only checkpoints to extract them from. */
export function oocCheckpointCandidate(
  runsDir: string,
  missing: ExtractTarget[],
  ipCount: number
): ReportCandidate {
  return {
    ...checkpointCandidate(runsDir, `${stageLabel('vivado', 'ooc')} (0 of ${ipCount} IPs)`, 'ooc'),
    id: `ooc:${runsDir}`,
    files: missing.map((target) => target.dcp),
    extract: missing,
  };
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false
  );
}

/**
 * The per-IP out-of-context report files of a project: the run's own report, else the one
 * extracted from the IP's checkpoint (an IP cache hit has no report, only that checkpoint).
 * `missing` are the IPs that have a checkpoint but no report yet.
 */
export async function oocReportFiles(
  runsDir: string,
  xciNames: Iterable<string | undefined>,
  storage: string | undefined
): Promise<{ files: string[]; missing: ExtractTarget[] }> {
  const files: string[] = [];
  const missing: ExtractTarget[] = [];
  for (const xci of new Set(xciNames)) {
    if (xci === undefined || !isPlainName(xci)) {
      continue;
    }
    const runDir = path.join(runsDir, `${xci}_synth_1`);
    const report = path.join(runDir, oocReportName(xci));
    if (await exists(report)) {
      files.push(report);
      continue;
    }
    const dcp = path.join(runDir, `${xci}.dcp`);
    if (!(await exists(dcp))) {
      continue;
    }
    const cached =
      storage === undefined ? undefined : await cachedReports(storage, dcp, [oocReportName(xci)]);
    if (cached) {
      files.push(cached[0]);
    } else {
      missing.push({ dcp, xciName: xci });
    }
  }
  return { files, missing };
}
