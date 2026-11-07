/** Pure projection of one level into a source x target connection count matrix. */

import type { NetCategory, SystemGraph } from '../../domain/systemGraph';
import { levelEdges } from './layout/levelEdges';
import { topologicalNodeOrder } from './layout/levelOrder';
import { categoryRank } from './legend';
import { isClockOrReset, parseBoundaryId } from './model';

export interface MatrixNode {
  id: string;
  label: string;
  kind: 'instance' | 'boundary';
}

export interface MatrixCount {
  category: NetCategory;
  count: number;
}

export interface ConnectivityMatrix {
  /** Rows and columns alike, in signal-flow order. */
  nodes: MatrixNode[];
  /** Counts per category, most first, of the non-empty cells keyed by {@link matrixKey}. */
  cells: Map<string, MatrixCount[]>;
}

export function matrixKey(rowId: string, colId: string): string {
  return `${rowId}\u0000${colId}`;
}

/**
 * Connections of `levelPath` itself (not of expanded inner levels) counted per
 * category from each source node to each target node. Clock and reset edges
 * are left out, and so are nodes with no other edge.
 */
export function connectivityMatrix(graph: SystemGraph, levelPath: string): ConnectivityMatrix {
  const counts = new Map<string, Map<NetCategory, number>>();
  const used = new Set<string>();
  for (const edge of levelEdges(graph, levelPath)) {
    if (isClockOrReset(edge)) {
      continue;
    }
    used.add(edge.sourceNode);
    used.add(edge.targetNode);
    const key = matrixKey(edge.sourceNode, edge.targetNode);
    const cell = counts.get(key) ?? new Map<NetCategory, number>();
    cell.set(edge.category, (cell.get(edge.category) ?? 0) + 1);
    counts.set(key, cell);
  }
  const nodes = topologicalNodeOrder(graph, levelPath, [...used]).map((id): MatrixNode => {
    const instance = graph.instances[id];
    return instance
      ? { id, label: instance.name, kind: 'instance' }
      : { id, label: parseBoundaryId(id).pin, kind: 'boundary' };
  });
  const cells = new Map<string, MatrixCount[]>();
  for (const [key, cell] of counts) {
    cells.set(
      key,
      [...cell]
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count || categoryRank(a.category) - categoryRank(b.category))
    );
  }
  return { nodes, cells };
}
