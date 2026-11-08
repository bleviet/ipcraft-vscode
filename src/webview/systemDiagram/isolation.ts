/** Pure rules of the isolated view: which nodes and edges stay when blocks are isolated. */

import type { SystemGraph } from '../../domain/systemGraph';
import type { IsolationSubset } from './layout/elkLayout';
import { levelEdges } from './layout/levelEdges';
import { isClockOrReset } from './model';

/**
 * Hop distance from the selected nodes to every node reachable over data and
 * interface edges of the level, in either direction (clock and reset edges
 * carry no hop). Selected nodes are at 0, including those without edges.
 */
export function hopDistances(
  graph: SystemGraph,
  levelPath: string,
  selectedNodeIds: Iterable<string>
): Map<string, number> {
  const neighbours = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const list = neighbours.get(from);
    if (list) {
      list.push(to);
    } else {
      neighbours.set(from, [to]);
    }
  };
  for (const edge of levelEdges(graph, levelPath)) {
    if (!isClockOrReset(edge)) {
      link(edge.sourceNode, edge.targetNode);
      link(edge.targetNode, edge.sourceNode);
    }
  }
  const distances = new Map<string, number>();
  let frontier = [...new Set(selectedNodeIds)];
  for (const id of frontier) {
    distances.set(id, 0);
  }
  for (let distance = 1; frontier.length > 0; distance += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const other of neighbours.get(id) ?? []) {
        if (!distances.has(other)) {
          distances.set(other, distance);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return distances;
}

/** The largest hop distance, 0 when nothing beyond the selection is reachable. */
export function maxHops(distances: ReadonlyMap<string, number>): number {
  return Math.max(0, ...distances.values());
}

/** The largest radius worth showing: the reach, at least 1 (the radius of a new isolation). */
export function maxRadius(distances: ReadonlyMap<string, number>): number {
  return Math.max(1, maxHops(distances));
}

/**
 * The visible nodes are those within `hops` data hops of a selected node (see
 * `hopDistances`); clock and reset edges pull no neighbour in. The edges kept
 * are those of any category between two visible nodes at least one of which is
 * closer than `hops`, so wires between two blocks of the outermost ring stay
 * hidden, unless `hops` reaches `maxRadius`: no further step could reveal
 * them, so every wire between the connected blocks is kept (the layout keeps
 * only the clock and reset edges that anchor a block, see `placementEdges`).
 * A selected node without edges is still shown. It depends on no view toggle.
 */
export function isolationSubset(
  graph: SystemGraph,
  levelPath: string,
  selectedNodeIds: Iterable<string>,
  hops = 1,
  distances: ReadonlyMap<string, number> = hopDistances(graph, levelPath, selectedNodeIds)
): IsolationSubset {
  const nodeIds = new Set<string>();
  for (const [id, distance] of distances) {
    if (distance <= hops) {
      nodeIds.add(id);
    }
  }
  const complete = hops >= maxRadius(distances);
  const inner = (id: string) => complete || (distances.get(id) ?? Infinity) < hops;
  const edgeIds = new Set(
    levelEdges(graph, levelPath)
      .filter(
        (edge) =>
          nodeIds.has(edge.sourceNode) &&
          nodeIds.has(edge.targetNode) &&
          (inner(edge.sourceNode) || inner(edge.targetNode))
      )
      .map((edge) => edge.id)
  );
  return { nodeIds, edgeIds };
}
