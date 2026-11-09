/**
 * Clock and reset wires of a laid-out level (issue #283). ELK places the blocks
 * from the data nets only; this adapter turns the clock and reset edges of every
 * drawn level into terminals and hands them to the router in `wireRoutes.ts`,
 * then back as ordinary flow edges.
 */

import type { SystemGraph } from '../../../domain/systemGraph';
import { boundaryId, isClockOrReset } from '../model';
import type { DiagramFlowEdge, DiagramFlowNode } from './diagramTypes';
import { nodeBounds, type DiagramBounds } from './diagramBounds';
import { frameLabelWidths } from './expandedLayout';
import { levelEdges, remapBoundaryEnds, type LevelEdge } from './levelEdges';
import { badgeDrawnWidth } from './netBadges';
import type { TextMeasure } from './nodeSizing';
import {
  routeNets,
  type NetRequest,
  type Point,
  type RoutedWire,
  type Terminal,
} from './wireRoutes';

type FrameNode = Extract<DiagramFlowNode, { type: 'frame' }>;

/** An expanded block seen from its inner level, with the widths of its pin label strips. */
interface Frame {
  node: FrameNode;
  pad: { west: number; east: number };
}

/** Where a wire meets the pin `pin` of `node`, seen from the level that holds `node`. */
function outerTerminal(
  node: DiagramFlowNode,
  pin: string,
  measure: TextMeasure
): Terminal | undefined {
  const badge =
    node.type === 'boundary'
      ? node.data.badge
      : [...node.data.west, ...node.data.east].find((row) => row.name === pin)?.badge;
  if (!badge) {
    return undefined;
  }
  const y = node.position.y + badge.y + badge.height / 2;
  // The wire stops just past the drawn text, not at the edge of the reserved box.
  const drawn = badgeDrawnWidth(badge, measure);
  return badge.x < 0
    ? { x: node.position.x + badge.x + badge.width - drawn, y, leaves: 'west' }
    : { x: node.position.x + badge.x + drawn, y, leaves: 'east' };
}

/** The label strips of a frame, which the wires of its inner level keep clear of. */
function labelStrips({ node, pad }: Frame): DiagramBounds[] {
  const { x, y } = node.position;
  return [
    { x, y, width: pad.west, height: node.height },
    { x: x + node.width - pad.east, y, width: pad.east, height: node.height },
  ];
}

/**
 * Where a wire of the inner level meets the pin `pin` of its frame: on the inner
 * edge of the label strip (`pullBack` moves it to the border, where the pin is).
 */
function frameTerminal({ node, pad }: Frame, pin: string): Terminal | undefined {
  const west = node.data.west.find((row) => row.name === pin);
  const row = west ?? node.data.east.find((candidate) => candidate.name === pin);
  if (!row) {
    return undefined;
  }
  const y = node.position.y + row.y;
  return west
    ? { x: node.position.x + pad.west, y, leaves: 'east' }
    : { x: node.position.x + node.width - pad.east, y, leaves: 'west' };
}

/** The clock and reset edges of `level` that are drawn, as its own level sees them. */
function levelClockResetEdges(
  graph: SystemGraph,
  level: string,
  levelPath: string,
  edgeIds: ReadonlySet<string> | undefined
): LevelEdge[] {
  const edges = levelEdges(graph, level).filter(isClockOrReset);
  return level === levelPath
    ? edges.filter((edge) => edgeIds?.has(edge.id) ?? true)
    : remapBoundaryEnds(edges, level);
}

/** Routing requests of one level, one per net, in `levelEdges` order. */
function levelRequests(
  edges: readonly LevelEdge[],
  byId: ReadonlyMap<string, DiagramFlowNode>,
  measure: TextMeasure,
  frame: Frame | undefined
): { requests: NetRequest[]; edgesById: Map<string, LevelEdge> } {
  const terminal = (nodeId: string, pin: string) => {
    const node = byId.get(nodeId);
    return nodeId === frame?.node.id
      ? frameTerminal(frame, pin)
      : node && outerTerminal(node, pin, measure);
  };
  const requests = new Map<string, NetRequest>();
  const edgesById = new Map<string, LevelEdge>();
  for (const edge of edges) {
    const netId = edge.id.slice(0, edge.id.lastIndexOf('#'));
    const sink = terminal(edge.targetNode, edge.targetPin);
    const driver = requests.get(netId)?.driver ?? terminal(edge.sourceNode, edge.sourcePin);
    if (!sink || !driver) {
      continue;
    }
    const request = requests.get(netId) ?? { id: netId, driver, sinks: [] };
    request.sinks.push({ id: edge.id, terminal: sink });
    requests.set(netId, request);
    edgesById.set(edge.id, edge);
  }
  return { requests: [...requests.values()], edgesById };
}

/** The points of `wire` with an end on a pin of `frame` moved from the strip edge to the border. */
function pullBack(
  wire: RoutedWire,
  edge: LevelEdge,
  { node }: Frame
): { points: Point[]; lead?: Point[] } {
  const border = (pin: string) =>
    node.data.west.some((row) => row.name === pin) ? node.position.x : node.position.x + node.width;
  const points = wire.points.map((point) => ({ ...point }));
  const lead = wire.lead?.map((point) => ({ ...point }));
  if (edge.targetNode === node.id) {
    points[points.length - 1].x = border(edge.targetPin);
  }
  if (edge.sourceNode === node.id) {
    (lead ?? points)[0].x = border(edge.sourcePin);
  }
  return { points, lead };
}

/**
 * The clock and reset wires of `levelPath` and of every expanded block's inner
 * level among `nodes`. Each level is routed on its own, around its own blocks
 * and clear of its own data wires. `edgeIds` limits `levelPath` to the edges an
 * isolated view keeps.
 */
export function clockResetWires(
  graph: SystemGraph,
  levelPath: string,
  nodes: readonly DiagramFlowNode[],
  dataEdges: readonly DiagramFlowEdge[],
  measure: TextMeasure,
  edgeIds?: ReadonlySet<string>
): DiagramFlowEdge[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const netsById = new Map(graph.nets.map((net) => [net.id, net]));
  const frames = new Map<string, Frame>();
  for (const node of nodes) {
    if (node.type === 'frame') {
      frames.set(node.id, { node, pad: frameLabelWidths(node.data.instance, measure) });
    }
  }
  const wires: DiagramFlowEdge[] = [];
  for (const level of [levelPath, ...frames.keys()]) {
    const frame = frames.get(level);
    const edges = levelClockResetEdges(graph, level, levelPath, edgeIds);
    const { requests, edgesById } = levelRequests(edges, byId, measure, frame);
    if (requests.length === 0) {
      continue;
    }
    const members = [
      ...(graph.levels[level]?.instances ?? []),
      ...(frame
        ? []
        : (graph.levels[level]?.boundaryPins ?? []).map((pin) => boundaryId(level, pin.name))),
    ].flatMap((id) => byId.get(id) ?? []);
    const dataWires = dataEdges
      .filter((edge) => netsById.get(edge.data.netId)?.level === level)
      .map((edge) => edge.data.points);
    const obstacles = [...members.map(nodeBounds), ...(frame ? labelStrips(frame) : [])];
    const routed = routeNets(obstacles, requests, dataWires);
    for (const [id, wire] of routed) {
      const edge = edgesById.get(id)!;
      const net = netsById.get(id.slice(0, id.lastIndexOf('#')))!;
      wires.push({
        id,
        type: 'elk',
        source: edge.sourceNode,
        target: edge.targetNode,
        sourceHandle: edge.sourcePin,
        targetHandle: edge.targetPin,
        data: {
          ...(frame ? pullBack(wire, edge, frame) : wire),
          netId: net.id,
          category: net.category,
          isInterface: net.isInterface,
          ...(wire.junction && { junction: true as const }),
        },
      });
    }
  }
  return wires;
}
