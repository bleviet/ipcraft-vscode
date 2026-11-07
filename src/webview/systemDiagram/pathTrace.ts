/** Pure path tracer: the shortest signal chain between two nodes of a level, for the isolated trace view. */

import type { NetCategory, SystemGraph } from '../../domain/systemGraph';
import type { IsolationSubset } from './layout/elkLayout';
import { levelEdges, type LevelEdge } from './layout/levelEdges';
import { categoryShort } from './legend';
import { boundaryId, isClockOrReset, isLevelNode, parseBoundaryId } from './model';

/** 1-2 follow the signal direction (net driver to sink); 3 ignores it. */
export type TraceTier = 1 | 2 | 3;

/** One step of a trace: the level edges between two consecutive nodes, in both directions. */
export interface TraceHop {
  from: string;
  to: string;
  edges: LevelEdge[];
}

export interface PathTrace {
  /** Node ids from the start to the end of the path. */
  order: string[];
  tier: TraceTier;
  hops: TraceHop[];
}

const INTERFACE_CATEGORIES: readonly NetCategory[] = [
  'aximm',
  'axis',
  'avalonmm',
  'avalonst',
  'interface',
];

const TIERS: { tier: TraceTier; directed: boolean; accepts: (edge: LevelEdge) => boolean }[] = [
  { tier: 1, directed: true, accepts: (edge) => INTERFACE_CATEGORIES.includes(edge.category) },
  {
    tier: 2,
    directed: true,
    accepts: (edge) =>
      INTERFACE_CATEGORIES.includes(edge.category) ||
      edge.category === 'interrupt' ||
      edge.category === 'signal',
  },
  { tier: 3, directed: false, accepts: (edge) => !isClockOrReset(edge) },
];

/** Shortest path by edge count; neighbours are tried in node id order, so ties are stable. */
function shortestPath(
  edges: readonly LevelEdge[],
  directed: boolean,
  fromId: string,
  toId: string
): string[] | null {
  const neighbours = new Map<string, Set<string>>();
  const link = (a: string, b: string) => neighbours.set(a, (neighbours.get(a) ?? new Set()).add(b));
  for (const edge of edges) {
    link(edge.sourceNode, edge.targetNode);
    if (!directed) {
      link(edge.targetNode, edge.sourceNode);
    }
  }
  const parent = new Map<string, string>();
  const seen = new Set([fromId]);
  let ring = [fromId];
  while (ring.length > 0 && !seen.has(toId)) {
    const next: string[] = [];
    for (const id of ring) {
      for (const other of [...(neighbours.get(id) ?? [])].sort()) {
        if (!seen.has(other)) {
          seen.add(other);
          parent.set(other, id);
          next.push(other);
        }
      }
    }
    ring = next;
  }
  if (!seen.has(toId)) {
    return null;
  }
  const path = [toId];
  while (path[0] !== fromId) {
    path.unshift(parent.get(path[0]) as string);
  }
  return path;
}

function betweenPair(edge: LevelEdge, a: string, b: string): boolean {
  return (
    (edge.sourceNode === a && edge.targetNode === b) ||
    (edge.sourceNode === b && edge.targetNode === a)
  );
}

/**
 * The shortest chain from `fromId` to `toId` among the nodes of `levelPath`
 * (its instances and boundary ports), or null when the nodes are the same, are
 * not nodes of the level, or no data path joins them. Tiers are tried in
 * order and the first with a path wins: along the signal direction over
 * interface categories, the same adding interrupts and signals, then ignoring
 * the direction. Clock and reset edges never carry a trace.
 */
export function computePathTrace(
  graph: SystemGraph,
  levelPath: string,
  fromId: string,
  toId: string
): PathTrace | null {
  if (
    fromId === toId ||
    !isLevelNode(graph, levelPath, fromId) ||
    !isLevelNode(graph, levelPath, toId)
  ) {
    return null;
  }
  const edges = levelEdges(graph, levelPath);
  for (const { tier, directed, accepts } of TIERS) {
    const tierEdges = edges.filter(accepts);
    const order = shortestPath(tierEdges, directed, fromId, toId);
    if (order) {
      const hops = order.slice(1).map((to, index) => ({
        from: order[index],
        to,
        edges: tierEdges.filter((edge) => betweenPair(edge, order[index], to)),
      }));
      return { order, tier, hops };
    }
  }
  return null;
}

/** The isolated view of a trace: the path nodes and every edge, of any category, between consecutive ones. */
export function traceSubset(
  graph: SystemGraph,
  levelPath: string,
  trace: PathTrace
): IsolationSubset {
  const edges = levelEdges(graph, levelPath);
  const edgeIds = new Set(
    trace.hops.flatMap((hop) =>
      edges.filter((edge) => betweenPair(edge, hop.from, hop.to)).map((edge) => edge.id)
    )
  );
  return { nodeIds: new Set(trace.order), edgeIds, order: trace.order };
}

/** `4 AXIS, 1 IRQ`-style summary of the connections of a hop, by category in first-seen order. */
export function hopSummary(hop: TraceHop): string {
  const counts = new Map<NetCategory, number>();
  for (const edge of hop.edges) {
    counts.set(edge.category, (counts.get(edge.category) ?? 0) + 1);
  }
  return [...counts].map(([category, count]) => `${count} ${categoryShort(category)}`).join(', ');
}

/** Ids of the nets the connections of a hop belong to, each once. */
export function hopNetIds(hop: TraceHop): string[] {
  return [...new Set(hop.edges.map((edge) => edge.id.slice(0, edge.id.lastIndexOf('#'))))];
}

/** Instance name, or boundary port name, of a node of the level. */
export function nodeName(graph: SystemGraph, nodeId: string): string {
  return graph.instances[nodeId]?.name ?? parseBoundaryId(nodeId).pin;
}

/** The nodes a trace can start or end on: the level's instances, then its ports, each sorted by name. */
export function traceEndpoints(
  graph: SystemGraph,
  levelPath: string
): { id: string; label: string }[] {
  const level = graph.levels[levelPath];
  const byLabel = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
  const instances = (level?.instances ?? []).map((id) => ({ id, label: nodeName(graph, id) }));
  const ports = (level?.boundaryPins ?? []).map((pin) => ({
    id: boundaryId(levelPath, pin.name),
    label: pin.name,
  }));
  return [...instances.sort(byLabel), ...ports.sort(byLabel)];
}

/** `5 hops · follows signal direction`: what a trace found. */
export function traceNote(trace: Pick<PathTrace, 'hops' | 'tier'>): string {
  const count = trace.hops.length;
  return `${count} ${count === 1 ? 'hop' : 'hops'} · ${trace.tier === 3 ? 'ignores direction' : 'follows signal direction'}`;
}
