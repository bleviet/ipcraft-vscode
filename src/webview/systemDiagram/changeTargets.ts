/** What a row of the Changes tab or the Findings tab selects in the current graph. */

import type { SystemGraph } from '../../domain/systemGraph';
import type { Finding, SystemGraphDiff } from '../../domain/systemGraphDiff';
import type { ChangeRow } from '../../services/systemDiagram/diff/changeRows';
import { boundaryId, type Selection } from './model';

export type ResolvedTarget = { kind: 'instance'; path: string } | { kind: 'port'; name: string };

/** The title of a row whose block or port is not in the current graph. */
export const NOT_IN_REVISION = 'Not in this revision';

/** Whether the diagram's selection is the block or external port a row selects. */
export function isTargetSelected(
  target: ResolvedTarget | undefined,
  selection: Selection | null
): boolean {
  if (!target || !selection) {
    return false;
  }
  return target.kind === 'instance'
    ? selection.kind === 'instance' && selection.id === target.path
    : selection.kind === 'boundary' && selection.id === boundaryId('/', target.name);
}

/** The slave block of the segment of `graph` with this address space and name, when the graph has both. */
export function segmentSlave(
  graph: SystemGraph,
  addressSpace: string,
  segment: string
): string | undefined {
  const found = graph.addressSegments.find(
    (s) => s.addressSpace === addressSpace && s.segment === segment
  );
  return found && graph.instances[found.slaveInstance] ? found.slaveInstance : undefined;
}

/**
 * The blocks a segment text can name, by the path the text spells, and the block of the current
 * graph each belongs to: a current block is its own; a removed block belongs to none (`undefined`);
 * a renamed block, and the blocks below a renamed hierarchy, are spelled by their base path and
 * belong to the block under its current name.
 */
export type SegmentOwners = ReadonlyMap<string, string | undefined>;

export function segmentOwners(graph: SystemGraph, diff: SystemGraphDiff): SegmentOwners {
  const owners = new Map<string, string | undefined>(
    Object.keys(graph.instances).map((path) => [path, path])
  );
  for (const change of diff.instances) {
    if (change.status === 'removed') {
      owners.set(change.path, undefined);
    } else if (change.status === 'renamed' && change.basePath !== undefined) {
      for (const path of Object.keys(graph.instances)) {
        if (path === change.path || path.startsWith(`${change.path}/`)) {
          owners.set(change.basePath + path.slice(change.path.length), path);
        }
      }
    }
  }
  return owners;
}

/**
 * The block of the current graph that a segment text starts with: a path of `owners` without the
 * leading slash, followed by `/` (Vivado) or `.` (Platform Designer), the spelling the diff's
 * rename code uses; the longest such path decides. When that is a removed block the segment
 * belongs to no block of the current graph (a surviving parent is not its slave).
 */
export function segmentTextOwner(owners: SegmentOwners, segment: string): string | undefined {
  const text = segment.startsWith('/') ? segment.slice(1) : segment;
  let best: string | undefined;
  for (const path of owners.keys()) {
    const spelled = path.slice(1);
    const next = text.charAt(spelled.length);
    if (
      text.startsWith(spelled) &&
      (next === '/' || next === '.') &&
      (best === undefined || path.length > best.length)
    ) {
      best = path;
    }
  }
  return best === undefined ? undefined : owners.get(best);
}

/**
 * The thing a row selects: its block or port, or for a segment the slave block of the segment
 * of the same address space and name; undefined when the graph has none.
 */
export function resolveTarget(graph: SystemGraph, row: ChangeRow): ResolvedTarget | undefined {
  const { target } = row;
  if (target?.kind !== 'segment') {
    return target;
  }
  const slave = segmentSlave(graph, target.addressSpace, target.segment);
  return slave ? { kind: 'instance', path: slave } : undefined;
}

/**
 * The block a row is about, also for a removed address segment, whose block is found by the
 * segment text. The Changes tab selects only what `resolveTarget` finds; Details lists the rows of
 * this block.
 */
export function blockOfRow(
  graph: SystemGraph,
  row: ChangeRow,
  owners: SegmentOwners
): ResolvedTarget | undefined {
  const target = resolveTarget(graph, row);
  if (target || row.section !== 'address' || row.target !== undefined) {
    return target;
  }
  const text = row.change[0]?.[0]?.text;
  const owner = text === undefined ? undefined : segmentTextOwner(owners, text);
  return owner ? { kind: 'instance', path: owner } : undefined;
}

/**
 * The block or external port a finding is about, when the current graph has it. An unconnected
 * pin selects its block, or the external port, or the hierarchy block whose boundary pin it is;
 * a crossing selects its sink block, else its source block, else the external port it ends at,
 * else the one it starts at.
 * Undefined for a finding of a block that is gone (a resolved one).
 */
export function findingTarget(graph: SystemGraph, finding: Finding): ResolvedTarget | undefined {
  const block = (path: string | null): ResolvedTarget | undefined =>
    path !== null && graph.instances[path] ? { kind: 'instance', path } : undefined;
  const port = (name: string): ResolvedTarget | undefined =>
    graph.levels['/']?.boundaryPins.some((pin) => pin.name === name)
      ? { kind: 'port', name }
      : undefined;
  if ('label' in finding) {
    if (finding.instance !== null) {
      return block(finding.instance);
    }
    return finding.level === '/' ? port(finding.pin) : block(finding.level);
  }
  return (
    block(finding.toInstance) ??
    block(finding.fromInstance) ??
    (finding.toInstance === null ? port(finding.to) : undefined) ??
    // `from` is a port here: a reset of unknown source (`from` = net name) is never a finding.
    (finding.fromInstance === null ? port(finding.from) : undefined)
  );
}
