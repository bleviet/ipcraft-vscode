/**
 * Maps the texts of report files onto a design, for callers that have the files at hand (the
 * command line): one hierarchical Vivado report, one Quartus `.map.rpt` / `.fit.rpt`, several
 * flat per-IP Vivado reports, or reports of one IP core built on its own. Files are recognized by
 * content, never by name. Pure: texts in, {@link ResourceReport} out; anything unusable throws a {@link ReportInputError}.
 */

import type { ResourceReport } from '../../domain/resourceUsage';
import type { SystemGraph } from '../../domain/systemGraph';
import { blockBuildOf } from './blockBuild';
import type { BuildReportInput } from './ipBuildUsage';
import { mapHierarchyReport, mapOocReports } from './mapReportToGraph';
import { FLAT_REASON, designOf, hierarchyInput, reportSource } from './reportInput';
import { recognizeReport, type RecognizedReport } from './reportKind';
import { readQuartusCapacity, readVivadoFlat } from './resourceMetrics';

export interface ReportText {
  /** What the messages and the report's source call the file. */
  name: string;
  text: string;
}

export interface MapReportOptions {
  /** A flat Vivado report or a Quartus `.fit.summary` that holds the device capacity. */
  capacity?: ReportText;
  /** The design in the report when it appears more than once (a report path of `rootCandidates`). */
  root?: string;
}

export interface MappedReports {
  report: ResourceReport;
  /** What the caller should tell the user without failing: the choice among several roots, an unused capacity. */
  notes: string[];
}

/** The input cannot be mapped: the message says why, for the user. */
export class ReportInputError extends Error {}

const listOf = (names: string[]): string => (names.length > 0 ? names.join(', ') : 'none');

interface Recognized {
  file: ReportText;
  recognition: RecognizedReport;
}

function recognizeAll(files: ReportText[]): Recognized[] {
  return files.map((file) => {
    const recognition = recognizeReport(file.text);
    if (!recognition.recognized) {
      throw new ReportInputError(`${file.name}: ${recognition.message}`);
    }
    return { file, recognition };
  });
}

function capacityText(capacity: ReportText, vendor: 'vivado' | 'quartus'): string {
  const found =
    vendor === 'quartus'
      ? readQuartusCapacity(capacity.text)
      : readVivadoFlat(capacity.text).capacity;
  if (Object.keys(found).length === 0) {
    throw new ReportInputError(
      `${capacity.name}: no device capacity found; give a flat Vivado utilization report or a Quartus .fit.summary`
    );
  }
  return capacity.text;
}

function mapHierarchy(
  { file, recognition }: Recognized,
  graph: SystemGraph,
  options: MapReportOptions
): MappedReports {
  const input = hierarchyInput(
    recognition,
    file.text,
    reportSource(recognition, file.name, true),
    options.capacity && capacityText(options.capacity, recognition.vendor)
  );
  const report = mapHierarchyReport(input, graph, options.root);
  const notes: string[] = [];
  const candidates = report.rootCandidates;
  if (options.root !== undefined && !candidates.includes(options.root)) {
    throw new ReportInputError(
      `--root '${options.root}' is not a candidate. Candidates: ${listOf(candidates)}`
    );
  }
  if (options.root === undefined && candidates.length > 1) {
    notes.push(
      `The design ${graph.name} appears ${candidates.length} times in the report; using ${candidates[0]}. Other candidates: ${listOf(candidates.slice(1))}. Pass --root to choose.`
    );
  }
  return { report, notes };
}

/** A report of one IP core built on its own, with the blocks of that IP. */
interface BlockBuild extends Recognized {
  instances: string[];
}

function mapOoc(
  flats: Recognized[],
  blocks: BlockBuild[],
  graph: SystemGraph,
  options: MapReportOptions
): MappedReports {
  const xciNames = new Set(Object.values(graph.instances).map((instance) => instance.xciName));
  for (const { file } of flats) {
    if (!xciNames.has(designOf(file.text))) {
      throw new ReportInputError(`${file.name}: ${FLAT_REASON}`);
    }
  }
  if (options.root !== undefined) {
    throw new ReportInputError('--root applies to a hierarchical report, not to per-IP reports');
  }
  const members = [...flats, ...blocks];
  const source = reportSource(
    members[0].recognition,
    members.map(({ file }) => file.name).join(', '),
    false
  );
  // Only a Quartus build takes the capacity from a `.fit.summary`; a Vivado report carries its own.
  const quartusBuilds = blocks.filter(({ recognition }) => recognition.vendor === 'quartus');
  const summary =
    options.capacity && quartusBuilds.length > 0
      ? capacityText(options.capacity, 'quartus')
      : undefined;
  const reports: BuildReportInput[] = [
    ...flats.map(({ file }) => ({ design: designOf(file.text), text: file.text })),
    ...blocks.flatMap(({ file, recognition, instances }) =>
      instances.map((instance) => ({
        instance,
        design: designOf(file.text),
        text: file.text,
        ...(recognition.vendor === 'quartus' && summary !== undefined && { capacityText: summary }),
      }))
    ),
  ];
  return {
    report: mapOocReports(reports, graph, source),
    notes:
      options.capacity && quartusBuilds.length === 0
        ? ['--capacity is not used with per-IP reports: they carry the device capacity themselves']
        : [],
  };
}

/** `files` mapped onto `graph`; see the module comment for what they may be. */
export function mapReportFiles(
  graph: SystemGraph,
  files: ReportText[],
  options: MapReportOptions = {}
): MappedReports {
  if (files.length === 0) {
    throw new ReportInputError('No report given');
  }
  const recognized = recognizeAll(files);
  const blocks: BlockBuild[] = [];
  const others: Recognized[] = [];
  for (const entry of recognized) {
    const block = blockBuildOf(graph, entry.recognition, entry.file.text);
    if (block) {
      blocks.push({ ...entry, instances: block.instances });
    } else {
      others.push(entry);
    }
  }
  const flats = others.filter(({ recognition }) => recognition.kind === 'vivado-flat');
  const hierarchies = others.filter(({ recognition }) => recognition.kind !== 'vivado-flat');
  if (hierarchies.length > 1) {
    throw new ReportInputError(
      `Give one hierarchical report, not ${hierarchies.length}: ${hierarchies.map(({ file }) => file.name).join(', ')}`
    );
  }
  if (hierarchies.length === 1 && flats.length + blocks.length > 0) {
    throw new ReportInputError(
      `Cannot mix the hierarchical report ${hierarchies[0].file.name} with the ${blocks.length > 0 ? 'per-IP' : 'flat'} reports ${[...flats, ...blocks].map(({ file }) => file.name).join(', ')}; give one hierarchical report or several per-IP reports`
    );
  }
  return hierarchies.length === 1
    ? mapHierarchy(hierarchies[0], graph, options)
    : mapOoc(flats, blocks, graph, options);
}
