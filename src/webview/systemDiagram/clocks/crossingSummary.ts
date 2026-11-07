/**
 * Counts and texts derived from the crossing records, shared by every surface:
 * the toolbar, node badges and outline rows.
 */

import type { SystemGraph } from '../../../domain/systemGraph';
import type { ClockAnalysis } from './analyzeClocks';
import type {
  ClockDomain,
  Crossing,
  CrossingEnd,
  CrossingKind,
  CrossingStatus,
} from './clockTypes';
import { isWithinLevel } from './levelPaths';
import { endKey } from './physicalNets';

export type CrossingCounts = Record<CrossingStatus, number>;

/** Number of crossings per status; of one kind when `kind` is given. */
export function crossingCounts(
  crossings: readonly Crossing[],
  kind?: CrossingKind
): CrossingCounts {
  const counts: CrossingCounts = { cross: 0, related: 0, inside: 0, unchecked: 0, ok: 0 };
  for (const crossing of crossings) {
    if (kind === undefined || crossing.kind === kind) {
      counts[crossing.status] += 1;
    }
  }
  return counts;
}

/** Crossings that touch net `netId` (any net of the physical net of a data crossing, or of the reset tree). */
export function crossingsOfNet(crossings: readonly Crossing[], netId: string): Crossing[] {
  return crossings.filter((crossing) => crossing.netIds.includes(netId));
}

/** The ends of a flagged crossing that are marked on the diagram: both for data, only the sink for a reset. */
function flaggedEnds(crossing: Crossing): CrossingEnd[] {
  if (crossing.kind === 'block' || crossing.status !== 'cross') {
    return [];
  }
  return crossing.kind === 'reset' ? [crossing.to] : [crossing.from, crossing.to];
}

export interface CrossingTally {
  data: number;
  reset: number;
}

function tally(
  crossings: readonly Crossing[],
  isMarked: (end: CrossingEnd) => boolean
): CrossingTally {
  const result: CrossingTally = { data: 0, reset: 0 };
  for (const crossing of crossings) {
    if (crossing.kind !== 'block' && flaggedEnds(crossing).some(isMarked)) {
      result[crossing.kind] += 1;
    }
  }
  return result;
}

/** Flagged crossings with a marked end on level `path` or nested below it. */
export function crossingsWithin(crossings: readonly Crossing[], path: string): CrossingTally {
  return tally(crossings, (end) => isWithinLevel(end.level, path));
}

/** The crossings of a diagram node: the pins of a leaf block, or everything inside a hierarchy block. */
export function nodeCrossings(
  graph: SystemGraph,
  crossings: readonly Crossing[],
  nodeId: string
): CrossingTally {
  return graph.instances[nodeId]?.kind === 'hier'
    ? crossingsWithin(crossings, nodeId)
    : tally(crossings, (end) => end.instance === nodeId);
}

/** Keys (see {@link endKey}) of the pins to mark as an end of a flagged crossing. */
export function crossingEndKeys(crossings: readonly Crossing[]): Set<string> {
  return new Set(crossings.flatMap((crossing) => flaggedEnds(crossing).map(endKey)));
}

/** `1 reset`, `2 resets`. */
export function plural(amount: number, one: string, many: string): string {
  return `${amount} ${amount === 1 ? one : many}`;
}

/** `2 CDC · 1 RDC`: only the kinds that are present, empty when there are none. */
export function crossingCountText(data: number, reset: number, separator = ' · '): string {
  return [data > 0 ? `${data} CDC` : '', reset > 0 ? `${reset} RDC` : '']
    .filter(Boolean)
    .join(separator);
}

/** The count chip of the Clocks and resets toggle: its text, the same in words for a screen reader, and its tone. */
export interface ToolbarSummary {
  text: string;
  label: string;
  warning: boolean;
}

/** Count chip of the Clocks and resets toggle: the flagged crossings, else the number of domains. */
export function toolbarSummary(analysis: ClockAnalysis): ToolbarSummary {
  const data = crossingCounts(analysis.crossings, 'data').cross;
  const reset = crossingCounts(analysis.crossings, 'reset').cross;
  if (data === 0 && reset === 0) {
    const domains = analysis.domains.length;
    return {
      text: String(domains),
      label: plural(domains, 'clock domain', 'clock domains'),
      warning: false,
    };
  }
  return {
    text: crossingCountText(data, reset),
    label: crossingCountText(data, reset, ', '),
    warning: true,
  };
}

/** Domains with a clock pin on the level (blocks, hierarchy pins, boundary pins), in domain order. */
export function levelDomains(
  analysis: ClockAnalysis,
  graph: SystemGraph,
  levelPath: string
): ClockDomain[] {
  const level = graph.levels[levelPath];
  const found = new Set<ClockDomain>();
  for (const path of level?.instances ?? []) {
    analysis.instanceDomains(path).forEach((domain) => found.add(domain));
  }
  for (const pin of level?.boundaryPins ?? []) {
    const domain = analysis.domainOfPin(levelPath, { instance: null, pin: pin.name });
    if (domain) {
      found.add(domain);
    }
  }
  return [...found].sort((a, b) => a.index - b.index);
}
