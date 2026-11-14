/**
 * The graph the layout of a comparison is made from (issue #302): the current graph plus the
 * ghosts of the comparison (see `unionAdditions`), and the ids that tell a ghost from the rest.
 * Pure. The graph of the open design stays the one every analysis and export reads; only the
 * layout, and what the viewer lets the user select while ghosts are shown, use the union.
 *
 * The union is the layout input whenever a comparison is on, whatever the toggles: hiding the
 * ghosts (Removed or Marks off) only leaves them out of what is drawn, so no block moves.
 */

import type { PinRef, SystemGraph, SystemNet } from '../../../domain/systemGraph';
import type { UnionAdditions } from '../../../domain/systemGraphDiff';
import { boundaryId, endpointKey, netsByEndpoint, netsOfLevel } from '../model';
import type { DiagramFlowEdge, DiagramFlowNode } from './diagramTypes';

/** What of a union graph only the base has. */
export interface Ghosts {
  /** Paths of the blocks. */
  instances: ReadonlySet<string>;
  /** Names of the pins that a block of the current graph lacks, by the path of the block. */
  pins: ReadonlyMap<string, ReadonlySet<string>>;
  /** Node ids (`boundaryId`) of the external ports. */
  boundary: ReadonlySet<string>;
  /** Ids of the nets. */
  nets: ReadonlySet<string>;
}

export const NO_GHOSTS: Ghosts = {
  instances: new Set(),
  pins: new Map(),
  boundary: new Set(),
  nets: new Set(),
};

export interface UnionGraph {
  graph: SystemGraph;
  ghosts: Ghosts;
}

/** Whether a node of the diagram (an instance path or a boundary node id) is a ghost. */
export const isGhostNode = (ghosts: Ghosts, nodeId: string): boolean =>
  ghosts.instances.has(nodeId) || ghosts.boundary.has(nodeId);

/** The number of blocks directly in `level` of the design as opened: the ghosts are not cells of it. */
export function openCellCount(
  graph: SystemGraph,
  level: string,
  ghostInstances: ReadonlySet<string>
): number {
  return (graph.levels[level]?.instances ?? []).filter((path) => !ghostInstances.has(path)).length;
}

/** Whether the end `ref` of a net of `level` is a ghost: a ghost block, a ghost pin, or a ghost port. */
function isGhostEnd(ghosts: Ghosts, level: string, ref: PinRef): boolean {
  return ref.instance === null
    ? ghosts.boundary.has(boundaryId(level, ref.pin))
    : ghosts.instances.has(ref.instance) || (ghosts.pins.get(ref.instance)?.has(ref.pin) ?? false);
}

/**
 * `netsByEndpoint` for the pins the layout draws: a ghost net is on the pins that only the base
 * has (a ghost block's, a ghost pin, a ghost port) and on no pin of the current graph, whose
 * pins keep the connections they have in the open design.
 */
export function layoutNetsByEndpoint(
  graph: SystemGraph,
  level: string,
  ghosts: Ghosts
): Map<string, SystemNet[]> {
  if (ghosts.nets.size === 0) {
    return netsByEndpoint(graph, level);
  }
  const lookup = new Map<string, SystemNet[]>();
  for (const net of netsOfLevel(graph, level)) {
    const ghost = ghosts.nets.has(net.id);
    for (const ref of net.endpoints) {
      if (!ghost || isGhostEnd(ghosts, level, ref)) {
        const key = endpointKey(ref);
        lookup.set(key, [...(lookup.get(key) ?? []), net]);
      }
    }
  }
  return lookup;
}

/**
 * `netsByEndpoint` for the design as opened: without the nets in `ghostNets` (the ids of the nets
 * only the base has), so a pin whose wire was lost is unconnected here, whether or not the graph
 * holds the ghost wire. A pin left with no net has no entry.
 */
export function openNetsByEndpoint(
  graph: SystemGraph,
  level: string,
  ghostNets: ReadonlySet<string>
): Map<string, SystemNet[]> {
  const lookup = netsByEndpoint(graph, level);
  if (ghostNets.size === 0) {
    return lookup;
  }
  const open = new Map<string, SystemNet[]>();
  for (const [key, nets] of lookup) {
    const kept = nets.filter((net) => !ghostNets.has(net.id));
    if (kept.length > 0) {
      open.set(key, kept);
    }
  }
  return open;
}

/**
 * `graph` with the additions merged in: ghost blocks join the instance list of their level,
 * ghost pins the pins of their block, ghost ports the boundary pins of the root, ghost nets the
 * nets. An addition that does not fit (a level or block that `graph` lacks, a path or pin it
 * already has) is left out. Without additions it is `graph` itself.
 */
export function withUnion(graph: SystemGraph, union: UnionAdditions | undefined): UnionGraph {
  if (
    !union ||
    union.instances.length + union.pins.length + union.boundaryPins.length + union.nets.length === 0
  ) {
    return { graph, ghosts: NO_GHOSTS };
  }
  const instances = { ...graph.instances };
  const levels = { ...graph.levels };
  const ghostInstances = new Set<string>();
  const ghostPins = new Map<string, Set<string>>();
  const ghostBoundary = new Set<string>();
  for (const instance of union.instances) {
    const level = levels[instance.parent];
    if (level && !instances[instance.path]) {
      instances[instance.path] = instance;
      levels[level.path] = { ...level, instances: [...level.instances, instance.path] };
      ghostInstances.add(instance.path);
    }
  }
  for (const { instance: path, pin } of union.pins) {
    const owner = instances[path];
    if (owner && !ghostInstances.has(path) && !owner.pins.some((p) => p.name === pin.name)) {
      instances[path] = { ...owner, pins: [...owner.pins, pin] };
      ghostPins.set(path, new Set([...(ghostPins.get(path) ?? []), pin.name]));
    }
  }
  for (const { level: path, pin } of union.boundaryPins) {
    const level = levels[path];
    if (level && !level.boundaryPins.some((candidate) => candidate.name === pin.name)) {
      levels[path] = { ...level, boundaryPins: [...level.boundaryPins, pin] };
      ghostBoundary.add(boundaryId(path, pin.name));
    }
  }
  const nets = union.nets.filter((net) => levels[net.level]);
  return {
    graph: { ...graph, instances, levels, nets: [...graph.nets, ...nets] },
    ghosts: {
      instances: ghostInstances,
      pins: ghostPins,
      boundary: ghostBoundary,
      nets: new Set(nets.map((net) => net.id)),
    },
  };
}

/** `layout` without the ghosts: their nodes and wires. The other nodes and wires are the same objects. */
export function withoutGhosts<L extends { nodes: DiagramFlowNode[]; edges: DiagramFlowEdge[] }>(
  layout: L,
  ghosts: Ghosts
): L {
  return ghosts.nets.size + ghosts.instances.size + ghosts.boundary.size === 0
    ? layout
    : {
        ...layout,
        nodes: layout.nodes.filter((node) => !isGhostNode(ghosts, node.id)),
        edges: layout.edges.filter((edge) => !ghosts.nets.has(edge.data.netId)),
      };
}
