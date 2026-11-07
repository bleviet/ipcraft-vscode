/**
 * Instances of one level in signal-flow order: a topological order of the
 * level's non-clock, non-reset edges between instances. Pure: no ELK, no React.
 */

import type { SystemGraph } from '../../../domain/systemGraph';
import { isClockOrReset, parseBoundaryId } from '../model';
import { levelEdges } from './levelEdges';

/**
 * Instance paths of `levelPath` ordered so a driver precedes its sinks (Kahn's
 * algorithm). Ties are broken by instance name then path; when a cycle leaves
 * no instance without an unplaced driver, the first by name is placed next.
 * Boundary pins, clock and reset nets and self connections do not count.
 */
export function topologicalInstanceOrder(graph: SystemGraph, levelPath: string): string[] {
  const paths = (graph.levels[levelPath]?.instances ?? []).filter((path) => graph.instances[path]);
  return topologicalNodeOrder(graph, levelPath, paths);
}

/**
 * The same order over any nodes of the level, instance paths and boundary pin
 * ids alike (a boundary pin is named by its pin). Edges to nodes outside
 * `paths` do not count.
 */
export function topologicalNodeOrder(
  graph: SystemGraph,
  levelPath: string,
  paths: readonly string[]
): string[] {
  const known = new Set(paths);
  const sinks = new Map<string, Set<string>>(paths.map((path) => [path, new Set()]));
  const drivers = new Map<string, number>(paths.map((path) => [path, 0]));
  for (const edge of levelEdges(graph, levelPath)) {
    const { sourceNode, targetNode } = edge;
    if (
      isClockOrReset(edge) ||
      sourceNode === targetNode ||
      !known.has(sourceNode) ||
      !known.has(targetNode) ||
      sinks.get(sourceNode)!.has(targetNode)
    ) {
      continue;
    }
    sinks.get(sourceNode)!.add(targetNode);
    drivers.set(targetNode, drivers.get(targetNode)! + 1);
  }
  const nameOf = (id: string) => graph.instances[id]?.name ?? parseBoundaryId(id).pin;
  const byName = (a: string, b: string) => nameOf(a).localeCompare(nameOf(b)) || a.localeCompare(b);
  const byOrder = [...paths].sort(byName);
  // The ready instances, kept in name order by inserting each where it belongs.
  const ready = byOrder.filter((path) => drivers.get(path) === 0);
  const placed = new Set<string>();
  const order: string[] = [];
  let cursor = 0;
  while (order.length < paths.length) {
    let next = ready.shift();
    if (next === undefined) {
      // A cycle: no instance is free of unplaced drivers, so take the first by name.
      while (placed.has(byOrder[cursor])) {
        cursor += 1;
      }
      next = byOrder[cursor];
    }
    placed.add(next);
    order.push(next);
    for (const sink of sinks.get(next)!) {
      const left = drivers.get(sink)! - 1;
      drivers.set(sink, left);
      if (left === 0 && !placed.has(sink)) {
        let at = ready.findIndex((path) => byName(sink, path) < 0);
        at = at < 0 ? ready.length : at;
        ready.splice(at, 0, sink);
      }
    }
  }
  return order;
}
