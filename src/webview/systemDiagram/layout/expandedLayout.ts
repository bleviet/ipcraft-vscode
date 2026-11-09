/**
 * Expanded hierarchy blocks. In the ELK graph an expanded block is a compound
 * node holding its inner level, its pins as ports centred on the border; after
 * layout it becomes the data of a frame node whose pin rows sit at the heights
 * of those ports.
 */

import type { ElkNode, ElkPort } from 'elkjs/lib/elk-api';
import type { SystemGraph, SystemInstance, SystemPin } from '../../../domain/systemGraph';
import { cellCount, endpointKey, netsByEndpoint } from '../model';
import type { FrameNodeData, FramePinRow, PinSide } from './diagramTypes';
import { portId } from './levelEdges';
import { badgeLabels, badgeOfPort, clockResetNetsByEndpoint } from './netBadges';
import { FRAME_MARGIN, framePadding, type TextMeasure } from './nodeSizing';
import { HEADER_HEIGHT, PIN_ROW_HEIGHT, PORT_SIZE, pinRow, splitSides } from './pinRows';
import { EDGE_MARGIN, LANE_STEP } from './wireRoutes';

type ClockResetNets = ReturnType<typeof clockResetNetsByEndpoint>;
type NetLookup = ReturnType<typeof netsByEndpoint>;

/** Least room between the frame's pin labels and its inner blocks for the trunks of clock and reset wires. */
export const FRAME_WIRE_CHANNEL = 24;

/**
 * Room beside the pin labels of each side for the trunks of the inner level's
 * clock and reset nets that end on a pin of that side: a lane each, at least
 * `FRAME_WIRE_CHANNEL`.
 */
export function frameWireChannels(
  graph: SystemGraph,
  instance: SystemInstance
): { west: number; east: number } {
  const inner = clockResetNetsByEndpoint(graph, instance.path);
  const sides = splitSides(instance.pins);
  const room = (pins: readonly SystemPin[]) => {
    const nets = new Set(
      pins
        .flatMap((pin) => inner.get(endpointKey({ instance: null, pin: pin.name })) ?? [])
        .map((net) => net.id)
    );
    return Math.max(FRAME_WIRE_CHANNEL, 2 * EDGE_MARGIN + (nets.size - 1) * LANE_STEP);
  };
  return { west: room(sides.west), east: room(sides.east) };
}

/** Widths of the strips on each side of a frame where it draws its pin labels. */
export function frameLabelWidths(
  instance: SystemInstance,
  measure: TextMeasure
): { west: number; east: number } {
  return framePadding(splitSides(instance.pins), measure);
}

export interface CompoundOptions {
  measure: TextMeasure;
  /** Algorithm options shared with the root. */
  baseOptions: Record<string, string>;
  /** Size of the block collapsed; the frame never gets smaller, even with an empty level inside. */
  minSize: { width: number; height: number };
}

/**
 * ELK node of an expanded block: ELK sizes it around `children`, the inner
 * level; its pins are ports pinned to their side and centred on the border like
 * instance ports, with room inside for the header and the pin labels. The
 * ports carry the badge labels of the outer level's clock and reset nets.
 */
export function compoundNode(
  graph: SystemGraph,
  instance: SystemInstance,
  clockReset: ClockResetNets,
  children: ElkNode[],
  { measure, baseOptions, minSize }: CompoundOptions
): ElkNode {
  const sides = splitSides(instance.pins);
  const padding = frameLabelWidths(instance, measure);
  const channel = frameWireChannels(graph, instance);
  const ports: ElkPort[] = (['west', 'east'] as const).flatMap((side) =>
    sides[side].map((pin) => ({
      id: portId(instance.path, pin.name),
      width: PORT_SIZE,
      height: PORT_SIZE,
      layoutOptions: {
        'elk.port.side': side === 'west' ? 'WEST' : 'EAST',
        'elk.port.borderOffset': String(-PORT_SIZE / 2),
      },
      labels: badgeLabels(graph, clockReset, { instance: instance.path, pin: pin.name }),
    }))
  );
  return {
    id: instance.path,
    layoutOptions: {
      ...baseOptions,
      'elk.portConstraints': 'FIXED_SIDE',
      'elk.spacing.portPort': String(PIN_ROW_HEIGHT),
      'elk.padding': `[top=${HEADER_HEIGHT + FRAME_MARGIN},left=${padding.west + channel.west},bottom=${FRAME_MARGIN},right=${padding.east + channel.east}]`,
      'elk.nodeSize.constraints': 'MINIMUM_SIZE',
      'elk.nodeSize.minimum': `(${minSize.width},${minSize.height})`,
    },
    ports,
    children,
  };
}

/**
 * Data of the frame drawn for a laid-out compound node. A pin sits on the nets
 * of both levels (outside nets first); only the outer level's clock and reset nets give
 * it a badge, as the inner blocks show their own.
 */
export function frameData(
  graph: SystemGraph,
  instance: SystemInstance,
  ports: ReadonlyMap<string, ElkPort>,
  outer: { nets: NetLookup; clockReset: ClockResetNets }
): FrameNodeData {
  const inner = netsByEndpoint(graph, instance.path);
  const rows: Record<PinSide, FramePinRow[]> = { west: [], east: [] };
  for (const pin of instance.pins) {
    const ref = { instance: instance.path, pin: pin.name };
    const port = ports.get(portId(instance.path, pin.name));
    const nets = [
      ...(outer.nets.get(endpointKey(ref)) ?? []),
      ...(inner.get(endpointKey({ instance: null, pin: pin.name })) ?? []),
    ];
    const row = pinRow(
      pin,
      nets,
      pin.name,
      badgeOfPort(port, outer.clockReset.get(endpointKey(ref)))
    );
    rows[row.side].push({ ...row, y: (port?.y ?? 0) + (port?.height ?? PORT_SIZE) / 2 });
  }
  return { instance, cellCount: cellCount(graph, instance.path), ...rows };
}
