/** Pure outline of an external port tag: a pointed tag whose arrow sits on the east edge. */

export const PORT_TIP = 12;

/**
 * Path of the tag in a `width` x `height` box. One pointed end at the east
 * edge; `bothEnds` (inout ports) adds a matching point on the west edge.
 */
export function portShapePath(width: number, height: number, bothEnds = false): string {
  const mid = height / 2;
  const east = `H${width - PORT_TIP} L${width},${mid} L${width - PORT_TIP},${height}`;
  return bothEnds ? `M${PORT_TIP},0 ${east} H${PORT_TIP} L0,${mid} Z` : `M0,0 ${east} H0 Z`;
}
