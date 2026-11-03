/**
 * Pure conversion between a {@link SystemGraph} level and ELK / React Flow.
 * One flat ELK graph per level: a node per instance and per boundary pin, a
 * fixed-position port per pin, and one edge per net sink from the net driver.
 */

import type { ElkExtendedEdge, ElkNode, ElkPort } from 'elkjs/lib/elk-api';
import type {
  NetCategory,
  PinDirection,
  PinDirectionSource,
  SystemGraph,
  SystemInstance,
  SystemPin,
} from '../../../domain/systemGraph';
import { badgeLabels, badgeOfPort, hiddenNetsByEndpoint, type NetBadge } from './netBadges';
import {
  boundaryId,
  cellCount,
  endpointKey,
  netByEndpoint,
  netDriver,
  pinRole,
  visibleNets,
} from '../model';

export const NODE_WIDTH = 240;
export const HEADER_HEIGHT = 42;
export const PIN_ROW_HEIGHT = 18;
export const BOUNDARY_WIDTH = 150;
export const BOUNDARY_HEIGHT = 26;
const PORT_SIZE = 8;
const PIN_TOP_OFFSET = 5;
const PIN_BOTTOM_PADDING = 10;

export type PinSide = 'west' | 'east';

export interface PinRow {
  name: string;
  isInterface: boolean;
  side: PinSide;
  direction: PinDirection;
  directionSource: PinDirectionSource;
  category?: NetCategory;
  netName?: string;
  /** Present when the pin's clock or reset net is hidden. */
  badge?: NetBadge;
}

export interface InstanceNodeData extends Record<string, unknown> {
  instance: SystemInstance;
  cellCount: number;
  west: PinRow[];
  east: PinRow[];
  dimmed?: boolean;
  onSelectNet?: (netId: string) => void;
}

export interface BoundaryNodeData extends Record<string, unknown> {
  pin: SystemPin;
  side: PinSide;
  category?: NetCategory;
  netName?: string;
  badge?: NetBadge;
  dimmed?: boolean;
  onSelectNet?: (netId: string) => void;
}

interface FlowNodeBase {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
  draggable: false;
}

export type DiagramFlowNode =
  | (FlowNodeBase & { type: 'instance'; data: InstanceNodeData })
  | (FlowNodeBase & { type: 'boundary'; data: BoundaryNodeData });

export interface ElkEdgeData extends Record<string, unknown> {
  points: { x: number; y: number }[];
  netId: string;
  category: NetCategory;
  isInterface: boolean;
}

export interface DiagramFlowEdge {
  id: string;
  type: 'elk';
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  data: ElkEdgeData;
}

export interface BuildElkOptions {
  showClockReset: boolean;
}

const LAYOUT_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.spacing.nodeNode': '28',
  'elk.layered.spacing.nodeNodeBetweenLayers': '80',
  'elk.layered.spacing.edgeNodeBetweenLayers': '24',
  'elk.spacing.edgeEdge': '12',
};

function sideOfInstancePin(direction: PinDirection): PinSide {
  return direction === 'out' || direction === 'master' || direction === 'inout' ? 'east' : 'west';
}

function portId(nodeId: string, pinName: string): string {
  return `${nodeId}::${pinName}`;
}

function splitSides(pins: readonly SystemPin[]): Record<PinSide, SystemPin[]> {
  const sides: Record<PinSide, SystemPin[]> = { west: [], east: [] };
  for (const pin of pins) {
    sides[sideOfInstancePin(pin.direction)].push(pin);
  }
  return sides;
}

function instanceHeight(instance: SystemInstance): number {
  const sides = splitSides(instance.pins);
  const rows = Math.max(sides.west.length, sides.east.length);
  return HEADER_HEIGHT + rows * PIN_ROW_HEIGHT + PIN_BOTTOM_PADDING;
}

type HiddenNets = ReturnType<typeof hiddenNetsByEndpoint>;

const PORT_LABEL_OPTIONS = { 'org.eclipse.elk.portLabels.placement': 'OUTSIDE' };

function instanceNode(instance: SystemInstance, hidden: HiddenNets): ElkNode {
  const sides = splitSides(instance.pins);
  const ports: ElkPort[] = (['west', 'east'] as const).flatMap((side) =>
    sides[side].map((pin, index) => ({
      id: portId(instance.path, pin.name),
      x: side === 'west' ? -PORT_SIZE / 2 : NODE_WIDTH - PORT_SIZE / 2,
      y: HEADER_HEIGHT + index * PIN_ROW_HEIGHT + PIN_TOP_OFFSET,
      width: PORT_SIZE,
      height: PORT_SIZE,
      labels: badgeLabels(hidden, { instance: instance.path, pin: pin.name }),
    }))
  );
  return {
    id: instance.path,
    width: NODE_WIDTH,
    height: instanceHeight(instance),
    layoutOptions: { 'org.eclipse.elk.portConstraints': 'FIXED_POS', ...PORT_LABEL_OPTIONS },
    ports,
  };
}

function boundarySide(pin: SystemPin): PinSide {
  return pinRole(pin, true) === 'source' ? 'east' : 'west';
}

function boundaryNode(levelPath: string, pin: SystemPin, hidden: HiddenNets): ElkNode {
  const id = boundaryId(levelPath, pin.name);
  const side = boundarySide(pin);
  const role = pinRole(pin, true);
  const layoutOptions: Record<string, string> = {
    'org.eclipse.elk.portConstraints': 'FIXED_POS',
    ...PORT_LABEL_OPTIONS,
  };
  if (role === 'source') {
    layoutOptions['elk.layered.layering.layerConstraint'] = 'FIRST';
  } else if (role === 'sink') {
    layoutOptions['elk.layered.layering.layerConstraint'] = 'LAST';
  }
  return {
    id,
    width: BOUNDARY_WIDTH,
    height: BOUNDARY_HEIGHT,
    layoutOptions,
    ports: [
      {
        id: portId(id, pin.name),
        x: side === 'west' ? -PORT_SIZE / 2 : BOUNDARY_WIDTH - PORT_SIZE / 2,
        y: (BOUNDARY_HEIGHT - PORT_SIZE) / 2,
        width: PORT_SIZE,
        height: PORT_SIZE,
        labels: badgeLabels(hidden, { instance: null, pin: pin.name }),
      },
    ],
  };
}

interface EndpointNode {
  nodeId: string;
  pinName: string;
}

function endpointNode(
  levelPath: string,
  ref: { instance: string | null; pin: string }
): EndpointNode {
  return {
    nodeId: ref.instance ?? boundaryId(levelPath, ref.pin),
    pinName: ref.pin,
  };
}

export function buildElkInput(
  graph: SystemGraph,
  levelPath: string,
  options: BuildElkOptions
): ElkNode {
  const level = graph.levels[levelPath];
  const children: ElkNode[] = [];
  const hidden = hiddenNetsByEndpoint(graph, levelPath, options.showClockReset);
  for (const path of level?.instances ?? []) {
    const instance = graph.instances[path];
    if (instance) {
      children.push(instanceNode(instance, hidden));
    }
  }
  for (const pin of level?.boundaryPins ?? []) {
    children.push(boundaryNode(levelPath, pin, hidden));
  }

  const knownPorts = new Set(children.flatMap((child) => (child.ports ?? []).map((p) => p.id)));
  const edges: ElkExtendedEdge[] = [];
  for (const net of visibleNets(graph, levelPath, options.showClockReset)) {
    const driver = netDriver(graph, net);
    if (!driver) {
      continue;
    }
    const from = endpointNode(levelPath, driver);
    const fromPort = portId(from.nodeId, from.pinName);
    net.endpoints.forEach((ref, index) => {
      const to = endpointNode(levelPath, ref);
      const toPort = portId(to.nodeId, to.pinName);
      if (toPort === fromPort || !knownPorts.has(fromPort) || !knownPorts.has(toPort)) {
        return;
      }
      edges.push({ id: `${net.id}#${index}`, sources: [fromPort], targets: [toPort] });
    });
  }

  return {
    id: `level:${levelPath}`,
    layoutOptions: LAYOUT_OPTIONS,
    children,
    edges,
  };
}

function pinRows(
  instance: SystemInstance,
  netLookup: ReturnType<typeof netByEndpoint>,
  ports: ReadonlyMap<string, ElkPort>,
  graph: SystemGraph
): Pick<InstanceNodeData, 'west' | 'east'> {
  const rows: Record<PinSide, PinRow[]> = { west: [], east: [] };
  for (const pin of instance.pins) {
    const net = netLookup.get(endpointKey({ instance: instance.path, pin: pin.name }));
    const side = sideOfInstancePin(pin.direction);
    rows[side].push({
      name: pin.name,
      isInterface: pin.isInterface,
      side,
      direction: pin.direction,
      directionSource: pin.directionSource,
      category: net?.category,
      netName: net?.name,
      badge: badgeOfPort(ports.get(portId(instance.path, pin.name)), graph),
    });
  }
  return rows;
}

function portsOf(node: ElkNode): Map<string, ElkPort> {
  return new Map((node.ports ?? []).map((port) => [port.id, port]));
}

export function toFlowElements(
  layoutResult: ElkNode,
  graph: SystemGraph,
  levelPath: string
): { nodes: DiagramFlowNode[]; edges: DiagramFlowEdge[] } {
  const netLookup = netByEndpoint(graph, levelPath);
  const boundaryPins = graph.levels[levelPath]?.boundaryPins ?? [];
  const nodes: DiagramFlowNode[] = [];

  for (const child of layoutResult.children ?? []) {
    const base = {
      position: { x: child.x ?? 0, y: child.y ?? 0 },
      width: child.width ?? NODE_WIDTH,
      height: child.height ?? 0,
      draggable: false as const,
    };
    const instance = graph.instances[child.id];
    if (instance) {
      nodes.push({
        ...base,
        id: child.id,
        type: 'instance',
        data: {
          instance,
          cellCount: cellCount(graph, instance.path),
          ...pinRows(instance, netLookup, portsOf(child), graph),
        },
      });
      continue;
    }
    const pin = boundaryPins.find(
      (candidate) => boundaryId(levelPath, candidate.name) === child.id
    );
    if (pin) {
      const net = netLookup.get(endpointKey({ instance: null, pin: pin.name }));
      nodes.push({
        ...base,
        id: child.id,
        type: 'boundary',
        data: {
          pin,
          side: boundarySide(pin),
          category: net?.category,
          netName: net?.name,
          badge: badgeOfPort(portsOf(child).get(portId(child.id, pin.name)), graph),
        },
      });
    }
  }

  const netsById = new Map(graph.nets.map((net) => [net.id, net]));
  const edges: DiagramFlowEdge[] = [];
  for (const elkEdge of layoutResult.edges ?? []) {
    const section = elkEdge.sections?.[0];
    const net = netsById.get(elkEdge.id.slice(0, elkEdge.id.lastIndexOf('#')));
    if (!section || !net) {
      continue;
    }
    const [source, sourceHandle] = splitPort(elkEdge.sources[0]);
    const [target, targetHandle] = splitPort(elkEdge.targets[0]);
    edges.push({
      id: elkEdge.id,
      type: 'elk',
      source,
      target,
      sourceHandle,
      targetHandle,
      data: {
        points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint],
        netId: net.id,
        category: net.category,
        isInterface: net.isInterface,
      },
    });
  }
  return { nodes, edges };
}

/** Splits `${nodeId}::${pin}` at the last separator (node ids may contain '::'). */
function splitPort(id: string): [string, string] {
  const cut = id.lastIndexOf('::');
  return [id.slice(0, cut), id.slice(cut + 2)];
}
