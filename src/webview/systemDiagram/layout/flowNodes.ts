/**
 * The flow nodes of a laid-out level: the instance, frame and boundary nodes React Flow draws, built
 * from the ELK result (positions, ports, badges) and the graph (nets, pin rows). The edges and the
 * entry point are in `elkLayout.ts`.
 */

import type { ElkNode, ElkPort } from 'elkjs/lib/elk-api';
import type { SystemGraph, SystemInstance } from '../../../domain/systemGraph';
import type { DiagramFlowNode, InstanceNodeData, PinRow, PinSide } from './diagramTypes';
import {
  boundaryLayout,
  instanceLayout,
  type InstanceLayout,
  type TextMeasure,
} from './nodeSizing';
import { frameData } from './expandedLayout';
import { pinHandles } from './nodeHandles';
import { portId } from './levelEdges';
import { badgeOfPort, clockResetNetsByEndpoint } from './netBadges';
import { boundarySide } from './boundaryColumns';
import { pinRow, splitSides } from './pinRows';
import { layoutNetsByEndpoint, openCellCount, type Ghosts } from './unionGraph';
import {
  boundaryId,
  cellCount,
  endpointKey,
  instanceSubtitle,
  type netsByEndpoint,
} from '../model';

type ClockResetNets = ReturnType<typeof clockResetNetsByEndpoint>;

// The subtitle is measured with the cell count of the graph given, which in a comparison is the union:
// the width, and so the layout, stays the same whatever the toggles. The subtitle drawn in the
// header uses the count of the open design (`addLevelNodes`, `openCellCount`).
export function sizeOfInstance(
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

function pinRows(
  instance: SystemInstance,
  netLookup: ReturnType<typeof netsByEndpoint>,
  ports: ReadonlyMap<string, ElkPort>,
  clockReset: ClockResetNets,
  labels: ReadonlyMap<string, string>,
  ghostPins?: ReadonlySet<string>
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
    rows[row.side].push(ghostPins?.has(pin.name) ? { ...row, ghost: true } : row);
  }
  return rows;
}

function portsOf(node: ElkNode): Map<string, ElkPort> {
  return new Map((node.ports ?? []).map((port) => [port.id, port]));
}

export interface FlowContext {
  graph: SystemGraph;
  measure: TextMeasure;
  ghosts: Ghosts;
}

/**
 * Appends the flow nodes of the children of `parent`, the laid-out node of
 * `levelPath` placed at `origin` (ELK positions are relative to the parent). A
 * frame precedes the nodes of its inner level.
 */
export function addLevelNodes(
  parent: ElkNode,
  levelPath: string,
  origin: { x: number; y: number },
  context: FlowContext,
  nodes: DiagramFlowNode[]
): void {
  const { graph, measure, ghosts } = context;
  const netLookup = layoutNetsByEndpoint(graph, levelPath, ghosts);
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
      const data = frameData(graph, instance, ports, {
        nets: netLookup,
        inner: layoutNetsByEndpoint(graph, instance.path, ghosts),
        clockReset,
        ghostPins: ghosts.pins.get(instance.path),
        cells: openCellCount(graph, instance.path, ghosts.instances),
      });
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
      addLevelNodes(child, instance.path, base.position, context, nodes);
      continue;
    }
    if (instance) {
      const sizing = sizeOfInstance(graph, instance, measure);
      const rows = pinRows(
        instance,
        netLookup,
        ports,
        clockReset,
        sizing.labels,
        ghosts.pins.get(instance.path)
      );
      nodes.push({
        ...base,
        handles: pinHandles(child.id, [...rows.west, ...rows.east], ports, (name) =>
          portId(instance.path, name)
        ),
        id: child.id,
        type: 'instance',
        data: {
          instance,
          cellCount: openCellCount(graph, instance.path, ghosts.instances),
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
