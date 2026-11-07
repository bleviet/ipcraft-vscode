/** Level edges attached to the ports ELK sees: an end on a pin of a folded group sits on the group's port. */

import type { ElkExtendedEdge } from 'elkjs/lib/elk-api';
import type { SystemGraph } from '../../../domain/systemGraph';
import { foldedPorts, type InstanceRows } from './instanceElk';
import { portId, type LevelEdge } from './levelEdges';

export interface PortEdge {
  edge: LevelEdge;
  /** Port id of the source end. */
  from: string;
  /** Port id of the target end. */
  to: string;
}

/**
 * `edges` with their ends on the ports of `rows` (the collapsed blocks of the
 * level); an edge that then starts and ends on one port is dropped.
 */
export function foldedEdges(
  graph: SystemGraph,
  edges: readonly LevelEdge[],
  rows: ReadonlyMap<string, InstanceRows>
): PortEdge[] {
  const folded = new Map<string, string>();
  for (const [path, instance] of rows) {
    foldedPorts(graph.instances[path], instance).forEach((group, pin) => folded.set(pin, group));
  }
  return edges.flatMap((edge) => {
    const source = portId(edge.sourceNode, edge.sourcePin);
    const target = portId(edge.targetNode, edge.targetPin);
    const from = folded.get(source) ?? source;
    const to = folded.get(target) ?? target;
    return from === to ? [] : [{ edge, from, to }];
  });
}

export function toElkEdge({ edge, from, to }: PortEdge): ElkExtendedEdge {
  return { id: edge.id, sources: [from], targets: [to] };
}
