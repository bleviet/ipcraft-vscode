/**
 * What the Clocks tab shows: only the clock and reset facts of the view on
 * screen. `shown` holds the levels in view, the current level plus the
 * hierarchy blocks expanded in place on it (see `shownLevels` in expansion.ts).
 */

import type { SystemGraph } from '../../../domain/systemGraph';
import type { ClockAnalysis } from './analyzeClocks';
import type { ClockDomain, Crossing, PinCrossing, ResetSource } from './clockTypes';

/** Pin crossings with an end on a shown level; one entirely inside a collapsed block is left out. */
export function crossingsInView(
  crossings: readonly Crossing[],
  shown: ReadonlySet<string>
): PinCrossing[] {
  return crossings.filter(
    (crossing): crossing is PinCrossing =>
      crossing.kind !== 'block' && (shown.has(crossing.from.level) || shown.has(crossing.to.level))
  );
}

/** Domains with a pin, the source or a load, on a shown level: one of their nets lies on it. */
export function domainsInView(
  graph: SystemGraph,
  domains: readonly ClockDomain[],
  shown: ReadonlySet<string>
): ClockDomain[] {
  const onShown = new Set(graph.nets.filter((net) => shown.has(net.level)).map((net) => net.id));
  return domains.filter((domain) => domain.netIds.some((netId) => onShown.has(netId)));
}

/** Reset sources whose source or any sink is on a shown level. */
export function resetsInView(
  resets: readonly ResetSource[],
  shown: ReadonlySet<string>
): ResetSource[] {
  return resets.filter(
    (reset) => shown.has(reset.level) || reset.sinks.some((sink) => shown.has(sink.level))
  );
}

/** The rows of the Clocks tab for the levels in `shown`. */
export interface ClocksInView {
  domains: ClockDomain[];
  resets: ResetSource[];
  crossings: PinCrossing[];
}

export function clocksInView(
  graph: SystemGraph,
  analysis: ClockAnalysis,
  shown: ReadonlySet<string>
): ClocksInView {
  return {
    domains: domainsInView(graph, analysis.domains, shown),
    resets: resetsInView(analysis.resets, shown),
    crossings: crossingsInView(analysis.crossings, shown),
  };
}
