/**
 * Turns report files into candidates for the resource view: recognizes each file from its
 * content, groups the per-IP out-of-context reports into one candidate, and pairs a hierarchy
 * report with the file that holds the device capacity. Extension side (reads files), no `vscode`.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { ResourceStage, ResourceVendor } from '../../domain/resourceUsage';
import type { SystemGraph } from '../../domain/systemGraph';
import { blockBuildOf } from './blockBuild';
import { FLAT_REASON } from './reportInput';
import { recognizeReport, type RecognizedReport, type RefusedReport } from './reportKind';

/** A Vivado checkpoint to extract a report from; `xciName` for the checkpoint of one out-of-context IP. */
export interface ExtractTarget {
  dcp: string;
  xciName?: string;
}

export interface ReportCandidate {
  /** Stable across discovery runs: the report file, or `ooc:<runs folder>` for the OOC group. */
  id: string;
  /**
   * `ooc`: a set of flat per-IP reports mapped by IP; `hierarchy`: one report with a table per
   * block; `checkpoint`: no report yet, only the checkpoint to extract one from; `ipBuilds`: the
   * build reports IPCraft wrote next to the `.ip.yml` of each block (see `builds`); `blockBuild`:
   * one report of a single IP core built on its own, for every block of that IP (see `builds`).
   */
  group: 'hierarchy' | 'ooc' | 'checkpoint' | 'ipBuilds' | 'blockBuild';
  vendor: ResourceVendor;
  /** Absent for a report that is not a utilization report. */
  stage?: ResourceStage;
  /** Short display, e.g. `Post-route (impl_1)`. */
  label: string;
  /** The report file, or the member files of the OOC group. */
  files: string[];
  /** A flat Vivado report or the Quartus `.fit.summary` that holds the device capacity. */
  capacityFile?: string;
  recognition: RecognizedReport | RefusedReport;
  usable: boolean;
  /** Why the report cannot be used; set when `usable` is false. */
  reason?: string;
  /** As written in the report header. */
  date?: string;
  /** Present when a report can be extracted: the checkpoint, or for the OOC group the IPs that lack a report. */
  extract?: ExtractTarget[];
  /** The checkpoint this report was extracted from, when it is one. */
  checkpoint?: string;
  /** `ipBuilds`: the report of each block that has one; `blockBuild`: the one report. */
  builds?: IpBuild[];
}

/** A build report of an IP core, for every instance defined by that core's `.ip.yml`. */
export interface IpBuild {
  instances: string[];
  file: string;
  /** Vivado: the run that wrote the report; a full implementation (`xpr`) is the fallback of an out-of-context (`ooc`) one. */
  mode?: 'ooc' | 'xpr';
  /** Quartus: the `.fit.summary` next to the report. */
  capacityFile?: string;
}

export interface ClassifyOptions {
  /**
   * `relevant`: a file that is not a utilization report at all (a timing report, another
   * file type) is skipped; `all`: every refusal is a candidate, so the user sees why.
   */
  refusals: 'relevant' | 'all';
  /** Shown in the label instead of the file name, e.g. the Vivado run folder. */
  detail?: string;
  /** The id of the OOC group; by default derived from the folder the members share. */
  oocId?: string;
}

const HEAD_BYTES = 4096;

const STAGE_LABEL: Record<ResourceStage, string> = {
  routed: 'Post-route',
  placed: 'Post-place',
  synth: 'Post-synthesis',
  fit: 'Fitter',
  ooc: 'Per-IP OOC',
};

export const stageLabel = (vendor: ResourceVendor, stage: ResourceStage): string =>
  vendor === 'quartus' && stage === 'synth' ? 'Synthesis' : STAGE_LABEL[stage];

/** A refused file has no vendor; the file name is the best hint for the label. */
export const guessVendor = (file: string): ResourceVendor =>
  /\.(map|fit|sta)\.|\.summary$/.test(path.basename(file)) ? 'quartus' : 'vivado';

export interface ReadReport {
  file: string;
  recognition: RecognizedReport | RefusedReport;
  /** Whole file; only for a recognized report. */
  text?: string;
  /** The file could not be read (a dangling link, no permission, a file being rewritten). */
  failed?: true;
}

async function readHead(file: string): Promise<string> {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** The header says what a file is; the whole file is read only when it is a utilization report. */
export async function readReport(file: string): Promise<ReadReport> {
  try {
    const head = recognizeReport(await readHead(file));
    // A Quartus entity table is far below the header: only the whole file can tell.
    if (head.recognized || head.reason === 'no-entity-table') {
      const text = await fs.readFile(file, 'utf8');
      const recognition = recognizeReport(text);
      return { file, recognition, ...(recognition.recognized && { text }) };
    }
    return { file, recognition: head };
  } catch (error) {
    const name = path.basename(file);
    // The message names the absolute path; the user sees the file name only.
    const detail = (error instanceof Error ? error.message : String(error)).split(file).join(name);
    return {
      file,
      failed: true,
      recognition: {
        recognized: false,
        reason: 'unknown',
        message: `${name} could not be read: ${detail}`,
      },
    };
  }
}

function commonFolder(files: string[]): string {
  const parts = files.map((file) => path.dirname(file).split(path.sep));
  const shared = parts[0].filter((part, i) => parts.every((p) => p[i] === part));
  return shared.join(path.sep) || path.sep;
}

/**
 * One candidate per hierarchy report, per build of one IP core on its own (a block build) and
 * per refused file, plus one for the group of per-IP OOC reports (flat reports whose Design is
 * the `xciName` of a block).
 */
export async function classifyReportFiles(
  files: string[],
  graph: SystemGraph,
  options: ClassifyOptions
): Promise<ReportCandidate[]> {
  const xciNames = new Set(
    Object.values(graph.instances)
      .map((instance) => instance.xciName)
      .filter((name): name is string => name !== undefined)
  );
  const summaries = new Set(files.filter((file) => file.endsWith('.fit.summary')));
  const reads: ReadReport[] = [];
  // A `.fit.summary` is read only for capacity (or refused below when nothing uses it).
  const isReport = (f: string) =>
    f.endsWith('.rpt') || (f.endsWith('.summary') && !summaries.has(f));
  for (const file of files.filter(isReport)) {
    reads.push(await readReport(file));
  }

  const found: ReportCandidate[] = [];
  const members: ReadReport[] = [];
  const flats: Array<{ file: string; recognition: RecognizedReport }> = [];
  const labelOf = (vendor: ResourceVendor, stage: ResourceStage | undefined, file: string) => {
    const detail = options.detail ?? path.basename(file);
    return stage ? `${stageLabel(vendor, stage)} (${detail})` : detail;
  };

  for (const read of reads) {
    const { file, recognition } = read;
    if (!recognition.recognized) {
      if (
        !read.failed &&
        options.refusals === 'relevant' &&
        (recognition.reason === 'not-utilization' || recognition.reason === 'unknown')
      ) {
        continue;
      }
      found.push({
        id: file,
        group: 'hierarchy',
        vendor: guessVendor(file),
        label: labelOf(guessVendor(file), undefined, file),
        files: [file],
        recognition,
        usable: false,
        reason: recognition.message,
      });
      continue;
    }
    const base = {
      id: file,
      group: 'hierarchy' as const,
      vendor: recognition.vendor,
      stage: recognition.stage,
      label: labelOf(recognition.vendor, recognition.stage, file),
      files: [file],
      recognition,
      ...(recognition.date !== undefined && { date: recognition.date }),
    };
    const block = read.text === undefined ? undefined : blockBuildOf(graph, recognition, read.text);
    if (block) {
      found.push({
        ...base,
        group: 'blockBuild',
        label: `${stageLabel(recognition.vendor, recognition.stage)}, build of ${block.top} (${options.detail ?? path.basename(file)})`,
        usable: true,
        builds: [{ instances: block.instances, file }],
      });
    } else if (recognition.kind !== 'vivado-flat') {
      found.push({ ...base, usable: true });
    } else if (recognition.design !== undefined && xciNames.has(recognition.design)) {
      members.push(read);
    } else {
      flats.push({ file, recognition });
      found.push({ ...base, usable: false, reason: FLAT_REASON });
    }
  }

  // A flat report that serves as the capacity of a hierarchy report of its stage is no source.
  const servesAsCapacity = (flat: { file: string; recognition: RecognizedReport }) =>
    found.some(
      (c) =>
        c.usable &&
        c.stage === flat.recognition.stage &&
        c.vendor === 'vivado' &&
        c.recognition.recognized &&
        c.recognition.device === flat.recognition.device &&
        path.dirname(c.files[0]) === path.dirname(flat.file)
    );
  const duplicates = new Set(flats.filter(servesAsCapacity).map((flat) => flat.file));
  for (let i = found.length - 1; i >= 0; i--) {
    if (duplicates.has(found[i].files[0]) && !found[i].usable) {
      found.splice(i, 1);
    }
  }

  for (const candidate of found.filter((c) => c.usable)) {
    const { recognition } = candidate;
    if (!recognition.recognized) {
      continue;
    }
    const dir = path.dirname(candidate.files[0]);
    if (recognition.kind === 'quartus-entity') {
      const summary = path.join(dir, `${recognition.revision ?? ''}.fit.summary`);
      if (summaries.has(summary)) {
        candidate.capacityFile = summary;
        if (candidate.builds?.[0]) {
          candidate.builds[0].capacityFile = summary;
        }
      }
      continue;
    }
    // A flat block build carries its own capacity.
    if (candidate.group === 'blockBuild') {
      continue;
    }
    const sameDevice = flats.filter(
      (flat) => path.dirname(flat.file) === dir && flat.recognition.device === recognition.device
    );
    const best = sameDevice.find((flat) => flat.recognition.stage === recognition.stage);
    const capacity = best ?? sameDevice[0];
    if (capacity) {
      candidate.capacityFile = capacity.file;
    }
  }

  if (options.refusals === 'all') {
    const used = new Set(found.map((candidate) => candidate.capacityFile));
    for (const file of summaries) {
      const { recognition } = await readReport(file);
      if (!used.has(file) && !recognition.recognized) {
        found.push({
          id: file,
          group: 'hierarchy',
          vendor: 'quartus',
          label: path.basename(file),
          files: [file],
          recognition,
          usable: false,
          reason: recognition.message,
        });
      }
    }
  }

  const first = members[0];
  if (first?.recognition.recognized) {
    const ipCount = Object.values(graph.instances).filter((i) => i.xciName !== undefined).length;
    const memberFiles = members.map((member) => member.file);
    found.push({
      id: options.oocId ?? `ooc:${commonFolder(memberFiles)}`,
      group: 'ooc',
      vendor: 'vivado',
      stage: 'ooc',
      label: `${stageLabel('vivado', 'ooc')} (${members.length} of ${ipCount} IPs)`,
      files: memberFiles,
      recognition: first.recognition,
      usable: true,
      ...(first.recognition.date !== undefined && { date: first.recognition.date }),
    });
  }
  return found;
}
