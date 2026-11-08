/** Which drawn wires belong to a flagged crossing. */

import type { Crossing } from './clockTypes';

/** The part of a drawn edge this module reads: `id` is `${net.id}#${endpointIndex}`. */
export interface CrossingEdge {
  id: string;
  data: { netId: string };
}

/**
 * Ids of the drawn edges to show as crossings: every edge of the nets of a
 * flagged clock domain crossing. A reset domain crossing marks no wire, only
 * its sink pin, since reset nets are drawn as badges.
 */
export function crossingEdgeIds(
  edges: readonly CrossingEdge[],
  crossings: readonly Crossing[]
): Set<string> {
  const netIds = new Set(
    crossings.flatMap((crossing) =>
      crossing.kind === 'data' && crossing.status === 'cross' ? crossing.netIds : []
    )
  );
  return new Set(edges.filter((edge) => netIds.has(edge.data.netId)).map((edge) => edge.id));
}
