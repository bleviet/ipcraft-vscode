/**
 * Reads the files of a usable report candidate and maps them onto a graph. The reading happens
 * once per source; mapping onto each new graph is pure and cheap.
 */

import * as fs from 'fs/promises';
import type { ResourceReport } from '../../domain/resourceUsage';
import type { SystemGraph } from '../../domain/systemGraph';
import type { BuildReportInput } from './ipBuildUsage';
import { mapHierarchyReport, mapOocReports, type HierarchyReportInput } from './mapReportToGraph';
import type { ReportCandidate } from './reportCandidates';
import { designOf, hierarchyInput, reportSource } from './reportInput';

export type LoadedSource = {
  /** Newest modification time of the report files (ms since the epoch). */
  modified: number;
} & (
  | { kind: 'hierarchy'; input: HierarchyReportInput }
  | {
      kind: 'ooc';
      reports: BuildReportInput[];
      source: ResourceReport['source'];
    }
);

/** One report per instance: a block's report is read once for all the instances of its IP. */
async function readIpBuilds(candidate: ReportCandidate): Promise<BuildReportInput[]> {
  const perBuild = await Promise.all(
    (candidate.builds ?? []).map(async (build) => {
      const text = await fs.readFile(build.file, 'utf8');
      // A capacity file that is gone or unreadable only costs the percentages.
      const capacityText =
        build.capacityFile === undefined
          ? undefined
          : await fs.readFile(build.capacityFile, 'utf8').catch(() => undefined);
      return build.instances.map((instance) => ({
        instance,
        design: designOf(text),
        text,
        ...(capacityText !== undefined && { capacityText }),
      }));
    })
  );
  return perBuild.flat();
}

/** `fileName` is what the report shows as its source: the workspace-relative or the original name. */
export async function loadCandidate(
  candidate: ReportCandidate,
  fileName: string
): Promise<LoadedSource> {
  const { recognition } = candidate;
  if (!recognition.recognized) {
    throw new Error(recognition.message);
  }
  // An extracted report is as old as the checkpoint it was extracted from, not as the extraction.
  const modified = Math.max(
    ...(await Promise.all(
      (candidate.checkpoint === undefined ? candidate.files : [candidate.checkpoint]).map(
        async (file) => (await fs.stat(file)).mtimeMs
      )
    ))
  );
  // The OOC group's first member names one IP, not the design.
  const source = reportSource(recognition, fileName, candidate.group === 'hierarchy');
  if (candidate.group === 'ipBuilds' || candidate.group === 'blockBuild') {
    return { kind: 'ooc', modified, reports: await readIpBuilds(candidate), source };
  }
  if (candidate.group === 'ooc') {
    const reports = await Promise.all(
      candidate.files.map(async (file) => {
        const text = await fs.readFile(file, 'utf8');
        return { design: designOf(text), text };
      })
    );
    return { kind: 'ooc', modified, reports, source };
  }
  const text = await fs.readFile(candidate.files[0], 'utf8');
  // A capacity file that is gone or unreadable only costs the percentages.
  const capacityText =
    candidate.capacityFile === undefined
      ? undefined
      : await fs.readFile(candidate.capacityFile, 'utf8').catch(() => undefined);
  return {
    kind: 'hierarchy',
    modified,
    input: hierarchyInput(recognition, text, source, capacityText),
  };
}

export function mapLoaded(
  loaded: LoadedSource,
  graph: SystemGraph,
  chosenRoot?: string
): ResourceReport {
  return loaded.kind === 'ooc'
    ? mapOocReports(loaded.reports, graph, loaded.source)
    : mapHierarchyReport(loaded.input, graph, chosenRoot);
}
