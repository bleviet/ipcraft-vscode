/**
 * Pure conversion between a {@link SystemGraph} level and ELK / React Flow.
 * One ELK graph per level: a node per instance and per boundary pin, a
 * fixed-position port per pin, and one edge per net sink from the net driver.
 * Clock and reset nets are edges too, and their pins reserve room for a badge:
 * the layout depends on no view toggle, the canvas draws the wires or the
 * badges (see `drawnLayout.ts`). An expanded hierarchy block is a compound node
 * holding its inner level (see `expandedLayout.ts`); the flow nodes stay flat,
 * in absolute coordinates.
 */

import type { ElkExtendedEdge, ElkNode, ElkPort } from 'elkjs/lib/elk-api';
import type { SystemGraph, SystemInstance, SystemPin } from '../../../domain/systemGraph';
import type { DiagramFlowEdge, DiagramFlowNode, IsolationSubset, PinSide } from './diagramTypes';
import { boundaryLayout, type TextMeasure } from './nodeSizing';
import { extendRouteEnds } from './edgePoints';
import type { BusBundling } from './edgeBundling';
import { foldedEdges, toElkEdge } from './foldedEdges';
import { compoundNode, frameData } from './expandedLayout';
import { levelEdges, portId, remapBoundaryEnds } from './levelEdges';
import { bundleElkEdge, laidOutBundleEdges, planInputBundles } from './levelBundles';
import { badgeLabels, badgeOfPort, clockResetNetsByEndpoint } from './netBadges';
import {
  PORT_LABEL_OPTIONS,
  type InstanceRows,
  flowPinRows,
  instanceHeight,
  instanceNode,
  instanceRows,
  sizeOfInstance,
} from './instanceElk';
import type { PinFolding } from './pinGrouping';
import { PARTITIONING_ON, withHopIndexes, withPartitions } from './tracePartition';
import { PORT_SIZE } from './pinRows';
import { boundaryId, cellCount, endpointKey, netsByEndpoint, pinRole } from '../model';

export { HEADER_HEIGHT, PIN_ROW_HEIGHT } from './pinRows';
export const BOUNDARY_HEIGHT = 26;

export type {
  BoundaryNodeData,
  DiagramFlowEdge,
  DiagramFlowNode,
  ElkEdgeData,
  FrameNodeData,
  FramePinRow,
  InstanceNodeData,
  IsolationSubset,
  PinRow,
  PinSide,
} from './diagramTypes';

export interface BuildElkOptions {
  measure: TextMeasure;
  /** Emit only this subset of the level's nodes and edges. */
  isolate?: IsolationSubset;
  /** Hierarchy blocks (instance paths) drawn expanded, with their inner level inside. */
  expanded?: ReadonlySet<string>;
  /** Fold numbered pin arrays of instance blocks; absent, every pin has its own row. */
  pinFolding?: PinFolding;
  /** Draw parallel connections between the same two blocks of the level as one trunk edge; absent, none. */
  busBundling?: BusBundling;
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

type ClockResetNets = ReturnType<typeof clockResetNetsByEndpoint>;

function boundarySide(pin: SystemPin): PinSide {
  return pinRole(pin, true) === 'source' ? 'east' : 'west';
}

function boundaryNode(
  graph: SystemGraph,
  levelPath: string,
  pin: SystemPin,
  width: number,
  clockReset: ClockResetNets,
  traced: boolean
): ElkNode {
  const id = boundaryId(levelPath, pin.name);
  const side = boundarySide(pin);
  const role = pinRole(pin, true);
  const layoutOptions: Record<string, string> = {
    'org.eclipse.elk.portConstraints': 'FIXED_POS',
    ...PORT_LABEL_OPTIONS,
  };
  // A traced path is ordered by partitions; ELK rejects a layer constraint beside them.
  if (!traced && role === 'source') {
    layoutOptions['elk.layered.layering.layerConstraint'] = 'FIRST';
  } else if (!traced && role === 'sink') {
    layoutOptions['elk.layered.layering.layerConstraint'] = 'LAST';
  }
  return {
    id,
    width,
    height: BOUNDARY_HEIGHT,
    layoutOptions,
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

/** Whether the hierarchy block is drawn as a compound node, its pins not folded. */
function isCompound(context: BuildContext, instance: SystemInstance): boolean {
  return instance.kind === 'hier' && (context.options.expanded?.has(instance.path) ?? false);
}

/** Collapsed blocks of `levelPath` by path, with their rows. */
function levelRows(
  context: BuildContext,
  levelPath: string,
  clockReset: ClockResetNets
): Map<string, InstanceRows> {
  const rows = new Map<string, InstanceRows>();
  for (const path of context.graph.levels[levelPath]?.instances ?? []) {
    const instance = context.graph.instances[path];
    if (instance && !isCompound(context, instance)) {
      rows.set(path, instanceRows(instance, clockReset, context.options.pinFolding));
    }
  }
  return rows;
}

/**
 * ELK edges of `levelPath`: those of an inner level end on the pins of its
 * frame. An end on a pin of a folded group attaches to the group's port; an
 * edge that then starts and ends on one port is dropped. On the current level
 * with bus bundling, a bundle is one edge between its representative ports.
 */
function elkEdges(
  context: BuildContext,
  levelPath: string,
  rows: ReadonlyMap<string, InstanceRows>
): ElkExtendedEdge[] {
  const { graph, options } = context;
  const edges = levelEdges(graph, levelPath);
  const isCurrent = levelPath === context.levelPath;
  const ported = foldedEdges(
    graph,
    isCurrent
      ? edges.filter((edge) => options.isolate?.edgeIds.has(edge.id) ?? true)
      : remapBoundaryEnds(edges, levelPath),
    rows
  );
  if (!isCurrent || !options.busBundling) {
    return ported.map(toElkEdge);
  }
  const { bundles, rest } = planInputBundles(graph, levelPath, ported, rows, options.busBundling);
  const unbundled = new Set(rest.map((candidate) => candidate.edgeId));
  return [
    ...ported.filter(({ edge }) => unbundled.has(edge.id)).map(toElkEdge),
    ...bundles.map(bundleElkEdge),
  ];
}

/** Nodes of `levelPath`; an expanded hierarchy block holds the nodes of its own level. */
function levelNodes(context: BuildContext, levelPath: string): ElkNode[] {
  const { graph, options } = context;
  const isCurrent = levelPath === context.levelPath;
  const level = graph.levels[levelPath];
  const children: ElkNode[] = [];
  const clockReset = clockResetNetsByEndpoint(graph, levelPath);
  const rows = levelRows(context, levelPath, clockReset);
  const isolate = isCurrent ? options.isolate : undefined;
  const shown = (id: string) => isolate?.nodeIds.has(id) ?? true;
  context.edges.push(...elkEdges(context, levelPath, rows));
  for (const path of level?.instances ?? []) {
    const instance = graph.instances[path];
    if (!instance || !shown(path)) {
      continue;
    }
    const collapsed = rows.get(path);
    if (!collapsed) {
      context.compound = true;
      const full = instanceRows(instance, clockReset);
      children.push(
        compoundNode(graph, instance, clockReset, levelNodes(context, path), {
          measure: options.measure,
          baseOptions: { ...LAYOUT_OPTIONS, ...PORT_LABEL_OPTIONS },
          minSize: {
            width: sizeOfInstance(graph, instance, full, options.measure).width,
            height: instanceHeight(full),
          },
        })
      );
    } else {
      children.push(
        instanceNode(
          graph,
          instance,
          collapsed,
          sizeOfInstance(graph, instance, collapsed, options.measure).width,
          clockReset
        )
      );
    }
  }
  // The boundary pins of an expanded level are the pins of its frame, not nodes.
  for (const pin of isCurrent ? (level?.boundaryPins ?? []) : []) {
    if (shown(boundaryId(levelPath, pin.name))) {
      children.push(
        boundaryNode(
          graph,
          levelPath,
          pin,
          boundaryLayout(pin, options.measure).width,
          clockReset,
          isolate?.order?.includes(boundaryId(levelPath, pin.name)) ?? false
        )
      );
    }
  }
  return isolate?.order !== undefined ? withPartitions(children, isolate.order) : children;
}

export function buildElkInput(
  graph: SystemGraph,
  levelPath: string,
  options: BuildElkOptions
): ElkNode {
  const context: BuildContext = { graph, levelPath, options, edges: [], compound: false };
  const children = levelNodes(context, levelPath);
  const layoutOptions =
    options.isolate?.order !== undefined
      ? { ...LAYOUT_OPTIONS, ...PARTITIONING_ON }
      : LAYOUT_OPTIONS;
  return {
    id: `level:${levelPath}`,
    layoutOptions: context.compound
      ? {
          ...layoutOptions,
          'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
          'elk.json.edgeCoords': 'ROOT',
        }
      : layoutOptions,
    children,
    edges: context.edges,
  };
}

function portsOf(node: ElkNode): Map<string, ElkPort> {
  return new Map((node.ports ?? []).map((port) => [port.id, port]));
}

interface FlowContext {
  graph: SystemGraph;
  measure: TextMeasure;
  pinFolding?: PinFolding;
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
  { graph, measure, pinFolding }: FlowContext,
  nodes: DiagramFlowNode[]
): void {
  const netLookup = netsByEndpoint(graph, levelPath);
  // Only pins whose ELK port carries a badge label read these nets.
  const clockReset = clockResetNetsByEndpoint(graph, levelPath);
  const boundaryPins = graph.levels[levelPath]?.boundaryPins ?? [];

  for (const child of parent.children ?? []) {
    const base = {
      position: { x: origin.x + (child.x ?? 0), y: origin.y + (child.y ?? 0) },
      width: child.width ?? 0,
      height: child.height ?? 0,
      draggable: false as const,
    };
    const instance = graph.instances[child.id];
    if (instance && child.children) {
      nodes.push({
        ...base,
        id: child.id,
        type: 'frame',
        zIndex: -1,
        data: frameData(graph, instance, portsOf(child), { nets: netLookup, clockReset }),
      });
      addLevelNodes(child, instance.path, base.position, { graph, measure, pinFolding }, nodes);
      continue;
    }
    if (instance) {
      const rows = instanceRows(instance, clockReset, pinFolding);
      const sizing = sizeOfInstance(graph, instance, rows, measure);
      nodes.push({
        ...base,
        id: child.id,
        type: 'instance',
        data: {
          instance,
          cellCount: cellCount(graph, instance.path),
          width: sizing.width,
          westWidth: sizing.westWidth,
          eastWidth: sizing.eastWidth,
          ...flowPinRows(instance, rows, netLookup, portsOf(child), clockReset, sizing.labels),
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
            portsOf(child).get(portId(child.id, pin.name)),
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
  pinFolding?: PinFolding,
  busBundling?: BusBundling,
  isolate?: IsolationSubset
): { nodes: DiagramFlowNode[]; edges: DiagramFlowEdge[] } {
  const nodes: DiagramFlowNode[] = [];
  addLevelNodes(layoutResult, levelPath, { x: 0, y: 0 }, { graph, measure, pinFolding }, nodes);

  const netsById = new Map(graph.nets.map((net) => [net.id, net]));
  const edges: DiagramFlowEdge[] = [];
  const bundleEdges = busBundling
    ? laidOutBundleEdges(graph, levelPath, layoutResult, {
        pinFolding,
        isolate,
        bundling: busBundling,
      })
    : undefined;
  for (const elkEdge of layoutResult.edges ?? []) {
    const section = elkEdge.sections?.[0];
    const bundleEdge = bundleEdges?.get(elkEdge.id);
    if (section && bundleEdge) {
      edges.push(bundleEdge(section));
      continue;
    }
    const net = netsById.get(elkEdge.id.slice(0, elkEdge.id.lastIndexOf('#')));
    if (!section || !net) {
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
  return { nodes: withHopIndexes(nodes, isolate?.order), edges };
}

/** Splits `${nodeId}::${pin}` at the last separator (node ids may contain '::'). */
function splitPort(id: string): [string, string] {
  const cut = id.lastIndexOf('::');
  return [id.slice(0, cut), id.slice(cut + 2)];
}
