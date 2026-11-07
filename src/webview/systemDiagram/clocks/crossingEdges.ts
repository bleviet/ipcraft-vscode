/** Which drawn wires belong to a flagged crossing. */

import type { PinRef, SystemGraph } from '../../../domain/systemGraph';
import type { Crossing, CrossingEnd, PinCrossing } from './clockTypes';
import { isWithinLevel } from './levelPaths';

/** The part of a drawn edge this module reads: `id` is `${net.id}#${endpointIndex}`. */
export interface CrossingEdge {
  id: string;
  data: { netId: string };
}

/**
 * Whether the edge that ends at `target` (an endpoint of a net on `netLevel`)
 * lies on the way from a reset source to `sink`: it reaches the sink, a
 * hierarchy pin of a block that contains the sink, or the boundary pin through
 * which the reset leaves a level that does not contain the sink.
 */
function leadsToSink(
  graph: SystemGraph,
  netLevel: string,
  target: PinRef,
  sink: CrossingEnd
): boolean {
  if (netLevel === sink.level && target.instance === sink.instance && target.pin === sink.pin) {
    return true;
  }
  if (target.instance === null) {
    return !isWithinLevel(sink.level, netLevel);
  }
  return (
    graph.instances[target.instance]?.kind === 'hier' && isWithinLevel(sink.level, target.instance)
  );
}

/**
 * Ids of the drawn edges to show as crossings. A data crossing marks every edge
 * of its nets; a reset crossing marks only the edges on the path from the reset
 * source to the failing sink. Only crossings with status `cross` count.
 */
export function crossingEdgeIds(
  graph: SystemGraph,
  edges: readonly CrossingEdge[],
  crossings: readonly Crossing[]
): Set<string> {
  const flagged = crossings.filter(
    (crossing): crossing is PinCrossing => crossing.kind !== 'block' && crossing.status === 'cross'
  );
  const nets = new Map(graph.nets.map((net) => [net.id, net]));
  const marked = new Set<string>();
  for (const edge of edges) {
    const net = nets.get(edge.data.netId);
    const target = net?.endpoints[Number(edge.id.slice(edge.id.lastIndexOf('#') + 1))];
    for (const crossing of flagged) {
      if (!crossing.netIds.includes(edge.data.netId)) {
        continue;
      }
      if (
        crossing.kind === 'data' ||
        (net && target && leadsToSink(graph, net.level, target, crossing.to))
      ) {
        marked.add(edge.id);
        break;
      }
    }
  }
  return marked;
}
