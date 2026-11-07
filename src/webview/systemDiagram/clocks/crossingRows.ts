/** Texts and links of the crossing rows in the Clocks tab. */

import type { SystemGraph } from '../../../domain/systemGraph';
import { categoryLabel } from '../legend';
import { isPlatformDesigner } from '../model';
import { levelSource, type LevelSource } from '../sourceFile';
import type { Crossing, CrossingEnd, CrossingStatus } from './clockTypes';

export const CROSSING_STATUSES: readonly { status: CrossingStatus; label: string; icon: string }[] =
  [
    { status: 'cross', label: 'Crossing', icon: '!' },
    { status: 'related', label: 'Related clocks', icon: '≈' },
    { status: 'inside', label: 'Block spans domains', icon: '⇄' },
    { status: 'unchecked', label: 'Not checked', icon: '?' },
    { status: 'ok', label: 'OK', icon: '✓' },
  ];

/** Interface type of a data crossing, `Reset`, or `Block`. */
export function crossingKind(crossing: Crossing): string {
  if (crossing.kind === 'block') {
    return 'Block';
  }
  if (crossing.kind === 'reset') {
    return 'Reset';
  }
  return crossing.category ? categoryLabel(crossing.category) : 'Data';
}

/** The word that replaces the domain of an asynchronous end; undefined for a clocked end. */
export function asynchronousText(end: CrossingEnd, role: 'from' | 'to'): string | undefined {
  if (!end.async) {
    return undefined;
  }
  return role === 'from' ? 'asynchronous' : 'asynchronous input';
}

/** What tells the clocks of a crossing: the reason when not checked or related, else where each end's clock is known from. */
export function crossingKnownFrom(crossing: Crossing): { reason?: string; sources: string[] } {
  if (
    crossing.kind === 'block' ||
    crossing.status === 'unchecked' ||
    crossing.status === 'related'
  ) {
    return { reason: crossing.reason, sources: [] };
  }
  return {
    sources: [crossing.from.knownFrom, crossing.to.knownFrom].filter(
      (text): text is string => text !== undefined
    ),
  };
}

/** Where to open the script for a crossing: its net, or the block. */
export function crossingSource(
  graph: SystemGraph,
  crossing: Crossing
): { source: LevelSource; line: number } | undefined {
  if (crossing.kind === 'block') {
    const instance = graph.instances[crossing.instance];
    return instance && { source: levelSource(graph, instance.parent), line: instance.line };
  }
  const net = graph.nets.find((candidate) => candidate.id === crossing.netId);
  return net && { source: levelSource(graph, net.level), line: net.line };
}

/** Name of a block and its level, for a block row. */
export function crossingBlockLabel(graph: SystemGraph, crossing: Crossing): string {
  if (crossing.kind !== 'block') {
    return '';
  }
  const instance = graph.instances[crossing.instance];
  const level = crossing.level === '/' ? graph.name : (graph.levels[crossing.level]?.name ?? '');
  return `${instance?.name ?? crossing.instance} (${level})`;
}

/** What the crossing list covers, as one sentence for the filter bar. */
export function coverageNote(graph: SystemGraph): string {
  const checked =
    'Checked: memory-mapped and streaming connections (AXI, Avalon) and resets, followed through hierarchies. A pin takes its clock from its .ip.yml, the only clock of its block, or all its clocks being on one domain.';
  return isPlatformDesigner(graph.source.format)
    ? `${checked} Platform Designer inserts clock-crossing adapters and reset synchronizers itself, so its crossings are listed as OK.`
    : checked;
}
