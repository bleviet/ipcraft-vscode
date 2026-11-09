/**
 * Pure conversion between a {@link SystemGraph} level and ELK / React Flow.
 * One ELK graph per level: a node per instance and per boundary pin, a
 * fixed-position port per pin, and one edge per net sink from the net driver.
 * The data and interface nets place the blocks (see `placementEdges.ts`). A
 * clock or reset net is routed after the layout by `clockResetWires.ts`; its
 * pins show a net-name badge, in the room their port labels reserve, as the
 * label at the wire end. An expanded hierarchy block is a compound node
 * holding its inner level (see `expandedLayout.ts`); the flow nodes stay flat,
 * in absolute coordinates.
 */

import type { ElkExtendedEdge, ElkNode, ElkPort } from 'elkjs/lib/elk-api';
import type { SystemGraph, SystemInstance, SystemPin } from '../../../domain/systemGraph';
import type {
  DiagramFlowEdge,
  DiagramFlowNode,
  InstanceNodeData,
  PinRow,
  PinSide,
} from './diagramTypes';
import {
  boundaryLayout,
  instanceLayout,
  type InstanceLayout,
  type TextMeasure,
} from './nodeSizing';
import { extendRouteEnds } from './edgePoints';
import { clockResetWires } from './clockResetWires';
import { compoundNode, frameData } from './expandedLayout';
import { pinHandles } from './nodeHandles';
import { levelEdges, portId, remapBoundaryEnds } from './levelEdges';
import { badgeLabels, badgeOfPort, clockResetNetsByEndpoint } from './netBadges';
import { placementEdges } from './placementEdges';
import { HEADER_HEIGHT, PIN_ROW_HEIGHT, PORT_SIZE, pinRow, splitSides } from './pinRows';
import {
  boundaryId,
  cellCount,
  endpointKey,
  instanceSubtitle,
  isClockOrReset,
  netsByEndpoint,
  pinRole,
} from '../model';

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

function sizeOfInstance(
  graph: SystemGraph,
  instance: SystemInstance,
  measure: TextMeasure
): InstanceLayout {
  return instanceLayout(
    instance,
    splitSides(instance.pins),
    instanceSubtitle(instance, cellCount(graph, instance.path)),
    measure
  );
}

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

function boundarySide(pin: SystemPin): PinSide {
  return pinRole(pin, true) === 'source' ? 'east' : 'west';
}

function boundaryNode(
  graph: SystemGraph,
  levelPath: string,
  pin: SystemPin,
  width: number,
  clockReset: ClockResetNets
): ElkNode {
  const id = boundaryId(levelPath, pin.name);
  const side = boundarySide(pin);
  return {
    id,
    width,
    height: BOUNDARY_HEIGHT,
    layoutOptions: { 'org.eclipse.elk.portConstraints': 'FIXED_POS', ...PORT_LABEL_OPTIONS },
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
  for (const pin of isCurrent ? (level?.boundaryPins ?? []) : []) {
    if (shown(boundaryId(levelPath, pin.name))) {
      children.push(
        boundaryNode(graph, levelPath, pin, boundaryLayout(pin, options.measure).width, clockReset)
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

function pinRows(
  instance: SystemInstance,
  netLookup: ReturnType<typeof netsByEndpoint>,
  ports: ReadonlyMap<string, ElkPort>,
  clockReset: ClockResetNets,
  labels: ReadonlyMap<string, string>
): Pick<InstanceNodeData, 'west' | 'east'> {
  const rows: Record<PinSide, PinRow[]> = { west: [], east: [] };
  for (const pin of instance.pins) {
    const ref = { instance: instance.path, pin: pin.name };
    const row = pinRow(
      pin,
      netLookup.get(endpointKey(ref)) ?? [],
      labels.get(pin.name)!,
      badgeOfPort(ports.get(portId(instance.path, pin.name)), clockReset.get(endpointKey(ref)))
    );
    rows[row.side].push(row);
  }
  return rows;
}

function portsOf(node: ElkNode): Map<string, ElkPort> {
  return new Map((node.ports ?? []).map((port) => [port.id, port]));
}

interface FlowContext {
  graph: SystemGraph;
  measure: TextMeasure;
}

/**
 * Appends the flow nodes of the children of `parent`, the laid-out node of
 * `levelPath` placed at `origin` (ELK positions are relative to the parent). A
 * frame precedes the nodes of its inner level.
 */
function addLevelNodes(
  parent: ElkNode,
  levelPath: string,
  origin: { x: number; y: number },
  { graph, measure }: FlowContext,
  nodes: DiagramFlowNode[]
): void {
  const netLookup = netsByEndpoint(graph, levelPath);
  // Only pins whose ELK port carries a badge label read these nets.
  const clockReset = clockResetNetsByEndpoint(graph, levelPath);
  const boundaryPins = graph.levels[levelPath]?.boundaryPins ?? [];

  for (const child of parent.children ?? []) {
    const width = child.width ?? 0;
    const height = child.height ?? 0;
    const base = {
      position: { x: origin.x + (child.x ?? 0), y: origin.y + (child.y ?? 0) },
      width,
      height,
      // With `handles` it stops React Flow from measuring the DOM for them: it would drop the
      // handles of a changed node and, with onlyRenderVisibleElements, mount it again off screen.
      measured: { width, height },
      draggable: false as const,
    };
    const instance = graph.instances[child.id];
    const ports = portsOf(child);
    if (instance && child.children) {
      const data = frameData(graph, instance, ports, { nets: netLookup, clockReset });
      nodes.push({
        ...base,
        handles: pinHandles(child.id, [...data.west, ...data.east], ports, (name) =>
          portId(instance.path, name)
        ),
        id: child.id,
        type: 'frame',
        zIndex: -1,
        data,
      });
      addLevelNodes(child, instance.path, base.position, { graph, measure }, nodes);
      continue;
    }
    if (instance) {
      const sizing = sizeOfInstance(graph, instance, measure);
      const rows = pinRows(instance, netLookup, ports, clockReset, sizing.labels);
      nodes.push({
        ...base,
        handles: pinHandles(child.id, [...rows.west, ...rows.east], ports, (name) =>
          portId(instance.path, name)
        ),
        id: child.id,
        type: 'instance',
        data: {
          instance,
          cellCount: cellCount(graph, instance.path),
          width: sizing.width,
          westWidth: sizing.westWidth,
          eastWidth: sizing.eastWidth,
          ...rows,
        },
      });
      continue;
    }
    const pin = boundaryPins.find(
      (candidate) => boundaryId(levelPath, candidate.name) === child.id
    );
    if (pin) {
      const ref = { instance: null, pin: pin.name };
      const nets = netLookup.get(endpointKey(ref)) ?? [];
      const net = nets[0];
      nodes.push({
        ...base,
        handles: pinHandles(
          child.id,
          [{ name: pin.name, side: boundarySide(pin) }],
          ports,
          (name) => portId(child.id, name)
        ),
        id: child.id,
        type: 'boundary',
        data: {
          pin,
          ...boundaryLayout(pin, measure),
          side: boundarySide(pin),
          category: net?.category,
          netName: net?.name,
          netNames: nets.map((candidate) => candidate.name),
          badge: badgeOfPort(
            ports.get(portId(child.id, pin.name)),
            clockReset.get(endpointKey(ref))
          ),
        },
      });
    }
  }
}

export function toFlowElements(
  layoutResult: ElkNode,
  graph: SystemGraph,
  levelPath: string,
  measure: TextMeasure,
  isolate?: IsolationSubset
): { nodes: DiagramFlowNode[]; edges: DiagramFlowEdge[] } {
  const nodes: DiagramFlowNode[] = [];
  addLevelNodes(layoutResult, levelPath, { x: 0, y: 0 }, { graph, measure }, nodes);

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
