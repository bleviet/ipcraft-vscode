/** Pure rules of the isolated view: which nodes and edges stay when blocks are isolated. */

import type { SystemGraph } from '../../domain/systemGraph';
import type { IsolationSubset } from './layout/elkLayout';
import { levelEdges } from './layout/levelEdges';
import { isClockOrReset } from './model';

export type IsolationHops = 1 | 2;

/**
 * The visible nodes are those within `hops` data edges of a selected node (hop
 * distance over edges of any direction); clock and reset edges pull no
 * neighbour in. The edges kept are those of any category between two visible
 * nodes at least one of which is closer than `hops`, so with one hop the
 * edges between a selected node and a visible one, and the clock and reset
 * wires between kept blocks are there to draw. A selected node without edges
 * is still shown. It depends on no view toggle.
 */
export function isolationSubset(
  graph: SystemGraph,
  levelPath: string,
  selectedNodeIds: Iterable<string>,
  hops: IsolationHops = 1
): IsolationSubset {
  const edges = levelEdges(graph, levelPath);
  const neighbours = new Map<string, string[]>();
  for (const edge of edges.filter((candidate) => !isClockOrReset(candidate))) {
    for (const [a, b] of [
      [edge.sourceNode, edge.targetNode],
      [edge.targetNode, edge.sourceNode],
    ]) {
      const list = neighbours.get(a);
      if (list) {
        list.push(b);
      } else {
        neighbours.set(a, [b]);
      }
    }
  }
  const distance = new Map<string, number>();
  let ring = [...new Set(selectedNodeIds)];
  for (const id of ring) {
    distance.set(id, 0);
  }
  for (let step = 1; step <= hops; step += 1) {
    const next: string[] = [];
    for (const id of ring) {
      for (const other of neighbours.get(id) ?? []) {
        if (!distance.has(other)) {
          distance.set(other, step);
          next.push(other);
        }
      }
    }
    ring = next;
  }
  const near = (id: string) => (distance.get(id) ?? hops) < hops;
  const edgeIds = new Set(
    edges
      .filter(
        (edge) =>
          distance.has(edge.sourceNode) &&
          distance.has(edge.targetNode) &&
          (near(edge.sourceNode) || near(edge.targetNode))
      )
      .map((edge) => edge.id)
  );
  return { nodeIds: new Set(distance.keys()), edgeIds };
}

/**
 * Exactly two nodes and every edge between them, of any category and either
 * direction (clock and reset included). Two equal ids isolate one node and its
 * own connections.
 */
export function pairSubset(
  graph: SystemGraph,
  levelPath: string,
  a: string,
  b: string
): IsolationSubset {
  const edgeIds = new Set(
    levelEdges(graph, levelPath)
      .filter(
        (edge) =>
          (edge.sourceNode === a && edge.targetNode === b) ||
          (edge.sourceNode === b && edge.targetNode === a)
      )
      .map((edge) => edge.id)
  );
  return { nodeIds: new Set([a, b]), edgeIds };
}
