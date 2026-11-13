/** What a row of the Changes tab selects in the current graph. */

import type { SystemGraph } from '../../domain/systemGraph';
import type { ChangeRow } from '../../services/systemDiagram/diff/changeRows';

export type ResolvedTarget = { kind: 'instance'; path: string } | { kind: 'port'; name: string };

/**
 * The thing a row selects: its block or port, or for a segment the slave block of the segment
 * of the same address space and name; undefined when the graph has none.
 */
export function resolveTarget(graph: SystemGraph, row: ChangeRow): ResolvedTarget | undefined {
  const { target } = row;
  if (target?.kind !== 'segment') {
    return target;
  }
  const segment = graph.addressSegments.find(
    (s) => s.addressSpace === target.addressSpace && s.segment === target.segment
  );
  return segment && graph.instances[segment.slaveInstance]
    ? { kind: 'instance', path: segment.slaveInstance }
    : undefined;
}
