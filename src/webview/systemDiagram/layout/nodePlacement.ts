/**
 * Node placement strategy of one ELK graph, chosen from its size alone.
 * Network simplex placement pulls connected blocks into line, so levels stay
 * short, but its time grows about with the square of the graph it places:
 * the nodes and edges, plus a dummy node per layer crossed by a long edge.
 * A net drawn to every stage of a deep pipeline crosses many layers, so a
 * small level can cost more than a wide one; the size estimates those dummies
 * (see {@link layeredGraphSize}). Clock and reset nets no longer reach ELK that
 * way (see `placementEdges.ts`), but the timings below were measured with them.
 * ELK time in Node 24 (Apple M1), network simplex / Brandes-Koepf, by
 * estimated size:
 *
 *   shape                                nodes+edges  size  NS / BK ms
 *   pipeline of 16 stages, one clock and          65   305  201 / 51
 *     one reset net to every stage: 17            69   341  250 / 60
 *                                   18            73   379  306 / 63
 *                                   24            97   649  859 / 107
 *                                   49           197  2549  13795 / 415
 *   DMA + FIFO pairs, Vivado (big17)             185   331  201 / 73
 *                            (big18)             195   349  230 / 78
 *                            (big20)             215   385  270 / 92
 *                            (big96)             991  1777  3987 / 454
 *   chain of 199 blocks, no clock                397   397  58 / 51
 *   largest fixture level (expanded)              66   120  41 / 29
 *
 * Up to {@link NETWORK_SIMPLEX_MAX_SIZE} network simplex stays under about
 * 250 ms. A plain chain is cheap at any size and is placed by Brandes-Koepf
 * above it all the same. The size reads only the ELK input, so no view toggle
 * can move a block.
 */

import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api';

export const NODE_PLACEMENT = 'elk.layered.nodePlacement.strategy';

/** Largest {@link layeredGraphSize} placed by network simplex. */
export const NETWORK_SIMPLEX_MAX_SIZE = 350;

export type NodePlacement = 'NETWORK_SIMPLEX' | 'BRANDES_KOEPF';

/** Nodes and edges of `root` at every depth, `root` itself not counted. */
export function elkGraphSize(root: ElkNode): number {
  return (
    (root.edges ?? []).length +
    (root.children ?? []).reduce((sum, child) => sum + 1 + elkGraphSize(child), 0)
  );
}

const LAYER_CONSTRAINT = 'elk.layered.layering.layerConstraint';

/** Every node below `root` (not `root`), parents before children, and every edge at every depth. */
function contents(root: ElkNode): { nodes: ElkNode[]; edges: ElkExtendedEdge[] } {
  const nodes: ElkNode[] = [];
  const edges: ElkExtendedEdge[] = [...(root.edges ?? [])];
  for (const child of root.children ?? []) {
    const inner = contents(child);
    nodes.push(child, ...inner.nodes);
    edges.push(...inner.edges);
  }
  return { nodes, edges };
}

/**
 * Longest-path layer of each node over `next` (successors by node), the edges
 * that close a cycle ignored: a depth-first search drops each edge into a node
 * still on its path, and its reverse postorder ranks the rest.
 */
function longestPathLayers(
  nodeIds: readonly string[],
  next: ReadonlyMap<string, string[]>
): Map<string, number> {
  const state = new Map<string, 'open' | 'done'>();
  const forward = new Map<string, string[]>();
  const postorder: string[] = [];
  const visit = (id: string) => {
    state.set(id, 'open');
    const kept: string[] = [];
    for (const to of next.get(id) ?? []) {
      if (state.get(to) !== 'open') {
        kept.push(to);
        if (!state.has(to)) {
          visit(to);
        }
      }
    }
    forward.set(id, kept);
    state.set(id, 'done');
    postorder.push(id);
  };
  nodeIds.forEach((id) => state.has(id) || visit(id));
  const layers = new Map(nodeIds.map((id) => [id, 0]));
  for (const id of postorder.reverse()) {
    for (const to of forward.get(id) ?? []) {
      layers.set(to, Math.max(layers.get(to) ?? 0, (layers.get(id) ?? 0) + 1));
    }
  }
  return layers;
}

/**
 * Dummy nodes that layering adds to `root`: an edge spanning `n` layers is
 * routed through `n - 1` of them. Estimated from a longest-path layering of
 * the edges between the nodes that own their ports, at every depth, with the
 * nodes constrained to the first or the last layer moved there.
 */
export function longEdgeDummies(root: ElkNode): number {
  const { nodes, edges } = contents(root);
  const owner = new Map<string, string>();
  for (const node of nodes) {
    owner.set(node.id, node.id);
    node.ports?.forEach((port) => owner.set(port.id, node.id));
  }
  const pairs = edges.flatMap((edge) => {
    const from = owner.get(edge.sources[0]);
    const to = owner.get(edge.targets[0]);
    return from !== undefined && to !== undefined && from !== to ? [[from, to] as const] : [];
  });
  const next = new Map<string, string[]>();
  for (const [from, to] of pairs) {
    const successors = next.get(from);
    if (successors) {
      successors.push(to);
    } else {
      next.set(from, [to]);
    }
  }
  const layers = longestPathLayers(
    nodes.map((node) => node.id),
    next
  );
  const last = Math.max(0, ...layers.values());
  for (const node of nodes) {
    const constraint = node.layoutOptions?.[LAYER_CONSTRAINT];
    if (constraint === 'FIRST' || constraint === 'LAST') {
      layers.set(node.id, constraint === 'FIRST' ? 0 : last);
    }
  }
  return pairs.reduce(
    (sum, [from, to]) =>
      sum + Math.max(0, Math.abs((layers.get(to) ?? 0) - (layers.get(from) ?? 0)) - 1),
    0
  );
}

/** Nodes, edges and estimated long-edge dummy nodes of `root`: what node placement places. */
export function layeredGraphSize(root: ElkNode): number {
  return elkGraphSize(root) + longEdgeDummies(root);
}

export function nodePlacementFor(size: number): NodePlacement {
  return size <= NETWORK_SIMPLEX_MAX_SIZE ? 'NETWORK_SIMPLEX' : 'BRANDES_KOEPF';
}

/** `node`, if it holds a graph, with `placement` on it and on every compound node inside. */
function placed(node: ElkNode, placement: NodePlacement): ElkNode {
  return node.children
    ? {
        ...node,
        layoutOptions: { ...node.layoutOptions, [NODE_PLACEMENT]: placement },
        children: node.children.map((child) => placed(child, placement)),
      }
    : node;
}

/** `root` with the node placement its size calls for, on the root and on every compound node. */
export function withNodePlacement(root: ElkNode): ElkNode {
  return placed(root, nodePlacementFor(layeredGraphSize(root)));
}
