/** Texts and links of the crossing rows in the Clocks and Resets tabs. */

import type { SystemGraph } from '../../../domain/systemGraph';
import { categoryLabel } from '../legend';
import { levelSource, type LevelSource } from '../sourceFile';
import type { Crossing, CrossingEnd, PinCrossing } from './clockTypes';
import { plural } from './crossingSummary';
import { formatHz, nameWithFrequency } from './frequency';

/** The rows of a crossings table: crossings without a synchronizer, and the ones not checked when asked for. */
export function listedCrossings(
  crossings: readonly Crossing[],
  showUnchecked: boolean
): PinCrossing[] {
  return crossings.filter(
    (crossing): crossing is PinCrossing =>
      crossing.kind !== 'block' &&
      (crossing.status === 'cross' || (showUnchecked && crossing.status === 'unchecked'))
  );
}

/** The line above the data crossings: how many in view need a synchronizer. */
export function dataCrossingsHeadline(flagged: number): string {
  return flagged === 0
    ? 'No clock domain crossings on this level.'
    : `${plural(flagged, 'crossing', 'crossings')} without a synchronizer.`;
}

/** The line above the reset crossings: how many in view are released on another clock domain or asynchronously. */
export function resetCrossingsHeadline(flagged: number): string {
  return flagged === 0
    ? 'No reset domain crossings on this level.'
    : `${plural(flagged, 'reset crossing', 'reset crossings')} without a synchronizer.`;
}

/** Interface type of a data crossing, or `Reset`. */
export function crossingKind(crossing: PinCrossing): string {
  if (crossing.kind === 'reset') {
    return 'Reset';
  }
  return crossing.category ? categoryLabel(crossing.category) : 'Data';
}

function domainText(end: CrossingEnd): string {
  return end.domain ? nameWithFrequency(end.domain) : end.label;
}

/** What is wrong with a row, in plain words; for a row not checked, why it could not be. */
export function crossingProblem(crossing: PinCrossing): string {
  if (crossing.status === 'unchecked') {
    return crossing.reason;
  }
  const { from, to } = crossing;
  if (crossing.kind === 'reset') {
    return `${from.async ? 'asynchronous reset' : `released by ${domainText(from)}`}, clocked by ${domainText(to)}`;
  }
  const [fromHz, toHz] = [from.domain?.hz, to.domain?.hz];
  // Frequencies tell the domains apart only when both are set and differ; otherwise name them.
  return fromHz !== undefined && toHz !== undefined && fromHz !== toHz
    ? `${formatHz(fromHz)} to ${formatHz(toHz)}, no synchronizer`
    : `${domainText(from)} to ${domainText(to)}, no synchronizer`;
}

function endProvenance(end: CrossingEnd): string {
  const clock = end.async
    ? 'asynchronous'
    : end.domain
      ? nameWithFrequency(end.domain)
      : end.sourceUnknown
        ? 'source not known'
        : 'clock not known';
  return `${end.label}: ${clock}${end.knownFrom === undefined ? '' : `, known from ${end.knownFrom}`}`;
}

/** The clock of each end of a crossing and how it was determined, one end per line, for the row's tooltip. */
export function crossingProvenance(crossing: PinCrossing): string {
  return `${endProvenance(crossing.from)}\n${endProvenance(crossing.to)}`;
}

/** Where to open the script for a crossing: its net. */
export function crossingSource(
  graph: SystemGraph,
  crossing: PinCrossing
): { source: LevelSource; line: number } | undefined {
  const net = graph.nets.find((candidate) => candidate.id === crossing.netId);
  return net && { source: levelSource(graph, net.level), line: net.line };
}
