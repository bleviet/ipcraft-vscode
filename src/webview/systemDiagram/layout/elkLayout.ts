/**
 * Pure conversion between a {@link SystemGraph} level and ELK / React Flow.
 * One ELK graph per level: a node per instance and per boundary pin, a
 * fixed-position port per pin, and one edge per net sink from the net driver.
 * The data and interface nets place the blocks (see `placementEdges.ts`); the
 * boundary pins of the level form two columns by ELK layer constraints (see
 * `boundaryColumns.ts`): inputs left of every block, left edges aligned, and every
 * other port right of every block, right edges aligned. A
 * clock or reset net is routed after the layout by `clockResetWires.ts`; its
 * pins show a net-name badge, in the room their port labels reserve, as the
 * label at the wire end. An expanded hierarchy block is a compound node
 * holding its inner level (see `expandedLayout.ts`); the flow nodes stay flat,
 * in absolute coordinates, and are built in `flowNodes.ts`.
 */

import type { ElkExtendedEdge, ElkNode, ElkPort } from 'elkjs/lib/elk-api';
import type { SystemGraph, SystemInstance, SystemPin } from '../../../domain/systemGraph';
import type { DiagramFlowEdge, DiagramFlowNode } from './diagramTypes';
import { boundaryLayout, type TextMeasure } from './nodeSizing';
import { extendRouteEnds } from './edgePoints';
import { clockResetWires } from './clockResetWires';
import { compoundNode } from './expandedLayout';
import { levelEdges, portId, remapBoundaryEnds } from './levelEdges';
import { badgeLabels, clockResetNetsByEndpoint } from './netBadges';
import {
  boundaryColumnOptions,
  boundarySide,
  rightColumnDrivers,
  type RightDrive,
} from './boundaryColumns';
import { addLevelNodes, sizeOfInstance } from './flowNodes';
import { placementEdges } from './placementEdges';
import { NO_GHOSTS, type Ghosts } from './unionGraph';
import { HEADER_HEIGHT, PIN_ROW_HEIGHT, PORT_SIZE, splitSides } from './pinRows';
import { boundaryId, isClockOrReset } from '../model';

export { HEADER_HEIGHT, PIN_ROW_HEIGHT } from './pinRows';
export const BOUNDARY_HEIGHT = 26;
/** Port top below its row top: 1 px border + 9 px row middle - half the 8 px port. */
const PIN_TOP_OFFSET = 6;
const PIN_BOTTOM_PADDING = 10;

export type {
  BoundaryNodeData,
  DiagramFlowEdge,
  DiagramFlowNode,
  ElkEdgeData,
  FrameNodeData,
  FramePinRow,
  InstanceNodeData,
  PinRow,
  PinSide,
} from './diagramTypes';

/** The nodes and edges (by id) an isolated view keeps. */
export interface IsolationSubset {
  nodeIds: ReadonlySet<string>;
  edgeIds: ReadonlySet<string>;
}

export interface BuildElkOptions {
  measure: TextMeasure;
  /** Emit only this subset of the level's nodes and edges. */
  isolate?: IsolationSubset;
  /** Hierarchy blocks (instance paths) drawn expanded, with their inner level inside. */
  expanded?: ReadonlySet<string>;
}

const LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.spacing.nodeNode': '28',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.layered.spacing.edgeNodeBetweenLayers': '24',
  'elk.spacing.edgeEdge': '12',
  // Keeps the block columns of the whole level aligned: the clock and reset wires are routed along them.
  'elk.separateConnectedComponents': 'false',
};

function instanceHeight(instance: SystemInstance): number {
  const sides = splitSides(instance.pins);
  const rows = Math.max(sides.west.length, sides.east.length);
  return HEADER_HEIGHT + rows * PIN_ROW_HEIGHT + PIN_BOTTOM_PADDING;
}

type ClockResetNets = ReturnType<typeof clockResetNetsByEndpoint>;

const PORT_LABEL_OPTIONS = { 'org.eclipse.elk.portLabels.placement': 'OUTSIDE' };

function instanceNode(
  graph: SystemGraph,
  instance: SystemInstance,
  width: number,
  clockReset: ClockResetNets
): ElkNode {
  const sides = splitSides(instance.pins);
  const ports: ElkPort[] = (['west', 'east'] as const).flatMap((side) =>
    sides[side].map((pin, index) => ({
      id: portId(instance.path, pin.name),
      x: side === 'west' ? -PORT_SIZE / 2 : width - PORT_SIZE / 2,
      y: HEADER_HEIGHT + index * PIN_ROW_HEIGHT + PIN_TOP_OFFSET,
      width: PORT_SIZE,
      height: PORT_SIZE,
      labels: badgeLabels(graph, clockReset, { instance: instance.path, pin: pin.name }),
    }))
  );
  return {
    id: instance.path,
    width,
    height: instanceHeight(instance),
    layoutOptions: { 'org.eclipse.elk.portConstraints': 'FIXED_POS', ...PORT_LABEL_OPTIONS },
    ports,
  };
}

function boundaryNode(
  graph: SystemGraph,
  levelPath: string,
  pin: SystemPin,
  width: number,
  clockReset: ClockResetNets,
  drive?: RightDrive
): ElkNode {
  const id = boundaryId(levelPath, pin.name);
  const side = boundarySide(pin);
  return {
    id,
    width,
    height: BOUNDARY_HEIGHT,
    layoutOptions: {
      'org.eclipse.elk.portConstraints': 'FIXED_POS',
      ...PORT_LABEL_OPTIONS,
      ...boundaryColumnOptions(pin, drive),
    },
    ports: [
      {
        id: portId(id, pin.name),
        x: side === 'west' ? -PORT_SIZE / 2 : width - PORT_SIZE / 2,
        y: (BOUNDARY_HEIGHT - PORT_SIZE) / 2,
        width: PORT_SIZE,
        height: PORT_SIZE,
        labels: badgeLabels(graph, clockReset, { instance: null, pin: pin.name }),
      },
    ],
  };
}

interface BuildContext {
  graph: SystemGraph;
  /** The level the graph is built for; its boundary pins are nodes and isolation applies to it. */
  levelPath: string;
  options: BuildElkOptions;
  /** Edges of every level in the graph; ELK routes them all from the root. */
  edges: ElkExtendedEdge[];
  /** Whether a hierarchy block was emitted as a compound node. */
  compound: boolean;
}

/** ELK edges of `levelPath`: those of an inner level end on the pins of its frame. */
function elkEdges(context: BuildContext, levelPath: string): ElkExtendedEdge[] {
  const { graph, options } = context;
  const edges = levelEdges(graph, levelPath);
  return placementEdges(
    levelPath === context.levelPath
      ? edges.filter((edge) => options.isolate?.edgeIds.has(edge.id) ?? true)
      : remapBoundaryEnds(edges, levelPath)
  ).map((edge) => ({
    id: edge.id,
    sources: [portId(edge.sourceNode, edge.sourcePin)],
    targets: [portId(edge.targetNode, edge.targetPin)],
  }));
}

/** Nodes of `levelPath`; an expanded hierarchy block holds the nodes of its own level. */
function levelNodes(context: BuildContext, levelPath: string): ElkNode[] {
  const { graph, options } = context;
  const isCurrent = levelPath === context.levelPath;
  const level = graph.levels[levelPath];
  const children: ElkNode[] = [];
  const clockReset = clockResetNetsByEndpoint(graph, levelPath);
  const isolate = isCurrent ? options.isolate : undefined;
  const shown = (id: string) => isolate?.nodeIds.has(id) ?? true;
  context.edges.push(...elkEdges(context, levelPath));
  for (const path of level?.instances ?? []) {
    const instance = graph.instances[path];
    if (!instance || !shown(path)) {
      continue;
    }
    if (instance.kind === 'hier' && options.expanded?.has(path)) {
      context.compound = true;
      children.push(
        compoundNode(graph, instance, clockReset, levelNodes(context, path), {
          measure: options.measure,
          baseOptions: { ...LAYOUT_OPTIONS, ...PORT_LABEL_OPTIONS },
          minSize: {
            width: sizeOfInstance(graph, instance, options.measure).width,
            height: instanceHeight(instance),
          },
        })
      );
    } else {
      children.push(
        instanceNode(
          graph,
          instance,
          sizeOfInstance(graph, instance, options.measure).width,
          clockReset
        )
      );
    }
  }
  // The boundary pins of an expanded level are the pins of its frame, not nodes.
  const drivers = isCurrent
    ? rightColumnDrivers(level?.boundaryPins ?? [], levelPath, context.edges)
    : new Map<string, RightDrive>();
  for (const pin of isCurrent ? (level?.boundaryPins ?? []) : []) {
    const id = boundaryId(levelPath, pin.name);
    if (shown(id)) {
      children.push(
        boundaryNode(
          graph,
          levelPath,
          pin,
          boundaryLayout(pin, options.measure).width,
          clockReset,
          drivers.get(id)
        )
      );
    }
  }
  return children;
}

export function buildElkInput(
  graph: SystemGraph,
  levelPath: string,
  options: BuildElkOptions
): ElkNode {
  const context: BuildContext = { graph, levelPath, options, edges: [], compound: false };
  const children = levelNodes(context, levelPath);
  return {
    id: `level:${levelPath}`,
    layoutOptions: context.compound
      ? {
          ...LAYOUT_OPTIONS,
          'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
          'elk.json.edgeCoords': 'ROOT',
        }
      : LAYOUT_OPTIONS,
    children,
    edges: context.edges,
  };
}

/**
 * The flow nodes and edges of a laid-out level. `ghosts` (a comparison's union layout, see
 * `unionGraph.ts`) tells the pins that only the base has, and keeps the nets only the base has
 * off the pins of the current graph.
 */
export function toFlowElements(
  layoutResult: ElkNode,
  graph: SystemGraph,
  levelPath: string,
  measure: TextMeasure,
  isolate?: IsolationSubset,
  ghosts: Ghosts = NO_GHOSTS
): { nodes: DiagramFlowNode[]; edges: DiagramFlowEdge[] } {
  const nodes: DiagramFlowNode[] = [];
  addLevelNodes(layoutResult, levelPath, { x: 0, y: 0 }, { graph, measure, ghosts }, nodes);

  const netsById = new Map(graph.nets.map((net) => [net.id, net]));
  const edges: DiagramFlowEdge[] = [];
  for (const elkEdge of layoutResult.edges ?? []) {
    const section = elkEdge.sections?.[0];
    const net = netsById.get(elkEdge.id.slice(0, elkEdge.id.lastIndexOf('#')));
    // A clock or reset edge only anchors a block in the layout; its wire is routed below.
    if (!section || !net || isClockOrReset(net)) {
      continue;
    }
    const [source, sourceHandle] = splitPort(elkEdge.sources[0]);
    const [target, targetHandle] = splitPort(elkEdge.targets[0]);
    // ELK ends a wire at the outer side of the port box. A wire of an expanded
    // block's inner level meets its frame pin from the inside: pull it back to
    // the border instead of pushing it past.
    const reach = (nodeId: string) => (nodeId === net.level ? -PORT_SIZE / 2 : PORT_SIZE / 2);
    edges.push({
      id: elkEdge.id,
      type: 'elk',
      source,
      target,
      sourceHandle,
      targetHandle,
      data: {
        points: extendRouteEnds(
          [section.startPoint, ...(section.bendPoints ?? []), section.endPoint],
          reach(source),
          reach(target)
        ),
        netId: net.id,
        category: net.category,
        isInterface: net.isInterface,
      },
    });
  }
  return {
    nodes,
    edges: [
      ...clockResetWires(graph, levelPath, nodes, edges, measure, isolate?.edgeIds),
      ...edges,
    ],
  };
}

/** Splits `${nodeId}::${pin}` at the last separator (node ids may contain '::'). */
function splitPort(id: string): [string, string] {
  const cut = id.lastIndexOf('::');
  return [id.slice(0, cut), id.slice(cut + 2)];
}
