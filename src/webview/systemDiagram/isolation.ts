/** Pure rules of the isolated view: which nodes and edges stay when blocks are isolated. */

import type { SystemGraph } from '../../domain/systemGraph';
import type { IsolationSubset } from './layout/elkLayout';
import { levelEdges } from './layout/levelEdges';
import { isClockOrReset } from './model';

/**
 * The visible nodes are the selected ones plus the other end of every data
 * edge of a selected node; clock and reset edges pull no neighbour in. The
 * edges kept are those of any category between a selected node and a visible
 * one, so the clock and reset wires between kept blocks are there to draw. A
 * selected node without edges is still shown. It depends on no view toggle.
 */
export function isolationSubset(
  graph: SystemGraph,
  levelPath: string,
  selectedNodeIds: Iterable<string>
): IsolationSubset {
  const selected = new Set(selectedNodeIds);
  const nodeIds = new Set(selected);
  const edges = levelEdges(graph, levelPath).filter(
    (edge) => selected.has(edge.sourceNode) || selected.has(edge.targetNode)
  );
  for (const edge of edges.filter((candidate) => !isClockOrReset(candidate))) {
    nodeIds.add(edge.sourceNode);
    nodeIds.add(edge.targetNode);
  }
  const edgeIds = new Set(
    edges
      .filter((edge) => nodeIds.has(edge.sourceNode) && nodeIds.has(edge.targetNode))
      .map((edge) => edge.id)
  );
  return { nodeIds, edgeIds };
}
