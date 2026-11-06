/** Pure rules of the isolated view: which nodes and edges stay when blocks are isolated. */

import type { SystemGraph } from '../../domain/systemGraph';
import type { IsolationSubset } from './layout/elkLayout';
import { levelEdges } from './layout/levelEdges';

/**
 * Keeps an edge when its source or target is selected; the visible nodes are
 * the selected ones plus the other end of every kept edge. A selected node
 * without edges is still shown.
 */
export function isolationSubset(
  graph: SystemGraph,
  levelPath: string,
  selectedNodeIds: Iterable<string>,
  showClockReset: boolean
): IsolationSubset {
  const selected = new Set(selectedNodeIds);
  const nodeIds = new Set(selected);
  const edgeIds = new Set<string>();
  for (const edge of levelEdges(graph, levelPath, showClockReset)) {
    if (selected.has(edge.sourceNode) || selected.has(edge.targetNode)) {
      edgeIds.add(edge.id);
      nodeIds.add(edge.sourceNode);
      nodeIds.add(edge.targetNode);
    }
  }
  return { nodeIds, edgeIds };
}
