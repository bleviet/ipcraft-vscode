/**
 * A report of one IP core built on its own ("block build"): the top of the report is the IP type
 * of one or more blocks of the design and the design itself is not in it. Pure: no files.
 */

import type { SystemGraph, SystemInstance } from '../../domain/systemGraph';
import { findCandidates } from './designRows';
import { parseQuartusEntities } from './quartusEntityTable';
import type { RecognizedReport } from './reportKind';

/**
 * The name of the IP core a block instantiates: the qsys `component`, else the Vivado module
 * reference, else the name of the `vlnv` (`vendor:library:name:version`). A hierarchy or a
 * blackbox has none.
 */
export function blockTypeName(instance: SystemInstance): string | undefined {
  if (instance.kind === 'hier' || instance.kind === 'blackbox') {
    return undefined;
  }
  return instance.component ?? instance.moduleRef ?? instance.vlnv?.split(':')[2];
}

/** The top of the report when it names an IP core and not the design. */
function topOf(
  graph: SystemGraph,
  recognition: RecognizedReport,
  text: string
): string | undefined {
  if (recognition.kind === 'quartus-entity') {
    const table = parseQuartusEntities(text);
    const top = table.root.module ?? table.root.name;
    return top !== '' && findCandidates(table, 'quartus', graph.name).length === 0
      ? top
      : undefined;
  }
  if (recognition.kind === 'vivado-flat') {
    const xciNames = Object.values(graph.instances).map((instance) => instance.xciName);
    return recognition.design && !xciNames.includes(recognition.design)
      ? recognition.design
      : undefined;
  }
  return undefined;
}

/** The blocks that `text` is a build of, or undefined when it is not a block build. */
export function blockBuildOf(
  graph: SystemGraph,
  recognition: RecognizedReport,
  text: string
): { top: string; instances: string[] } | undefined {
  const top = topOf(graph, recognition, text);
  if (top === undefined) {
    return undefined;
  }
  const instances = Object.values(graph.instances)
    .filter((instance) => blockTypeName(instance)?.toLowerCase() === top.toLowerCase())
    .map((instance) => instance.path);
  return instances.length > 0 ? { top, instances } : undefined;
}

/** Why a report has no row for the design; `top` is the top of the report. */
export function rootMissingMessage(design: string, top?: string): string {
  return top && top !== design
    ? `This report is a build of ${top}, not of the design ${design}`
    : `The design ${design} is not in this report`;
}
