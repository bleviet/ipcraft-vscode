/**
 * The edges that place the blocks of a level: its data and interface nets. A
 * clock or reset edge is kept only when it ends on a block that no data edge
 * touches, so a block with no data net on the level (a clock wizard, a reset
 * block, a clock source, the load of a clock input port) stays next to its
 * driver without pushing the data blocks to later columns. A driver left with
 * no edge at all (a clock or reset input port whose loads all have data edges)
 * keeps its first clock or reset edge, which only orders it vertically next to
 * one of its loads: the input ports of a level sit in a column of their own
 * (see `boundaryNode` in `elkLayout.ts`), so the edge never moves them sideways.
 */

import type { LevelEdge } from './levelEdges';
import { isClockOrReset } from '../model';

export function placementEdges(edges: readonly LevelEdge[]): LevelEdge[] {
  const dataNodes = new Set<string>();
  for (const edge of edges) {
    if (!isClockOrReset(edge)) {
      dataNodes.add(edge.sourceNode);
      dataNodes.add(edge.targetNode);
    }
  }
  const kept = new Set(
    edges.filter((edge) => !isClockOrReset(edge) || !dataNodes.has(edge.targetNode))
  );
  const placed = new Set([...kept].flatMap((edge) => [edge.sourceNode, edge.targetNode]));
  for (const edge of edges) {
    if (!kept.has(edge) && !placed.has(edge.sourceNode)) {
      kept.add(edge);
      placed.add(edge.sourceNode);
    }
  }
  return edges.filter((edge) => kept.has(edge));
}
