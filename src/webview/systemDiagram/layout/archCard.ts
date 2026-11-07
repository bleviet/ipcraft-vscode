/**
 * Arch cards: an instance block drawn as a compact card without pin rows. The
 * card has one port per side (every pin of that side maps to it), a row of
 * interface count pills and, for a hierarchy block, one preview line of its
 * inner instances. Pure: no ELK, no React.
 */

import type { ElkPort } from 'elkjs/lib/elk-api';
import type {
  NetCategory,
  SystemGraph,
  SystemInstance,
  SystemNet,
} from '../../../domain/systemGraph';
import { categoryShort, legendEntries } from '../legend';
import { endpointKey, isClockOrReset } from '../model';
import type { ArchSummary, PinSide } from './diagramTypes';
import type { PortSpot } from './edgeBundling';
import { portId } from './levelEdges';
import { topologicalInstanceOrder } from './levelOrder';
import { HEADER_HEIGHT, PORT_SIZE, splitSides } from './pinRows';
import type { TextMeasure } from './nodeSizing';

/** Port names of a card; no pin is named so, and neither holds `::`. */
export const ARCH_WEST = '*arch|west';
export const ARCH_EAST = '*arch|east';

export const ARCH_PILL_HEIGHT = 22;
export const ARCH_PREVIEW_HEIGHT = 18;
export const ARCH_BOTTOM_PADDING = 8;
const MAX_PILLS = 3;
const MAX_PREVIEW_NAMES = 3;
const PREVIEW_SEPARATOR = ' → ';
/** What a pill spends besides its text, from the CSS: 2 x 6 px padding, plus a 6 px dot and a 4 px gap when it has a dot. */
const PILL_PADDING = 12;
const PILL_DOT = 10;
/** Gap between pills. */
const PILL_GAP = 4;
const ROW_PADDING = 16;
const NODE_BORDER = 2;

export const archPortName = (side: PinSide): string => (side === 'west' ? ARCH_WEST : ARCH_EAST);

/** A card in the rows of an instance: its pins by side, its summary and its height. */
export interface ArchLayout {
  members: Record<PinSide, string[]>;
  summary: ArchSummary;
  height: number;
}

/**
 * Pills for the connected pins of `instance` grouped by the category of their
 * net, clock and reset excluded: count descending, then legend order.
 */
export function archPills(
  instance: SystemInstance,
  nets: ReadonlyMap<string, readonly Pick<SystemNet, 'category'>[]>
): Pick<ArchSummary, 'pills' | 'more'> {
  const counts = new Map<NetCategory, number>();
  for (const pin of instance.pins) {
    const net = nets.get(endpointKey({ instance: instance.path, pin: pin.name }))?.[0];
    if (net && !isClockOrReset(net)) {
      counts.set(net.category, (counts.get(net.category) ?? 0) + 1);
    }
  }
  const order = legendEntries(Array.from(counts.keys(), (category) => ({ category })));
  const sorted = order
    .map((entry) => ({ category: entry.category, count: counts.get(entry.category)! }))
    .sort((a, b) => b.count - a.count);
  return {
    pills: sorted.slice(0, MAX_PILLS).map(({ category, count }) => ({
      category,
      count,
      label: `${count}× ${categoryShort(category)}`,
    })),
    more: Math.max(0, sorted.length - MAX_PILLS),
  };
}

/** `a → b → c +2`: the first inner instances in signal-flow order; undefined for none or a non-hierarchy block. */
export function hierarchyPreview(graph: SystemGraph, instance: SystemInstance): string | undefined {
  if (instance.kind !== 'hier') {
    return undefined;
  }
  const names = topologicalInstanceOrder(graph, instance.path).map(
    (path) => graph.instances[path].name
  );
  if (names.length === 0) {
    return undefined;
  }
  const rest = names.length - MAX_PREVIEW_NAMES;
  return `${names.slice(0, MAX_PREVIEW_NAMES).join(PREVIEW_SEPARATOR)}${rest > 0 ? ` +${rest}` : ''}`;
}

export function archLayout(
  graph: SystemGraph,
  instance: SystemInstance,
  nets: ReadonlyMap<string, readonly Pick<SystemNet, 'category'>[]>
): ArchLayout {
  const sides = splitSides(instance.pins);
  const preview = hierarchyPreview(graph, instance);
  return {
    members: {
      west: sides.west.map((pin) => pin.name),
      east: sides.east.map((pin) => pin.name),
    },
    summary: { ...archPills(instance, nets), ...(preview !== undefined && { preview }) },
    height:
      HEADER_HEIGHT +
      ARCH_PILL_HEIGHT +
      (preview !== undefined ? ARCH_PREVIEW_HEIGHT : 0) +
      ARCH_BOTTOM_PADDING,
  };
}

/** Width the pill row needs: the pills (the `+N` has no dot), the gaps and the card padding. */
export function archPillsWidth(summary: ArchSummary, measure: TextMeasure): number {
  const widths = [
    ...summary.pills.map((pill) => measure(pill.label, 'pill') + PILL_PADDING + PILL_DOT),
    ...(summary.more > 0 ? [measure(`+${summary.more}`, 'pill') + PILL_PADDING] : []),
  ];
  if (widths.length === 0) {
    return 0;
  }
  return (
    widths.reduce((sum, width) => sum + width, 0) +
    (widths.length - 1) * PILL_GAP +
    ROW_PADDING +
    NODE_BORDER
  );
}

/** The sides of the card that have pins. */
const portedSides = (layout: ArchLayout): PinSide[] =>
  (['west', 'east'] as const).filter((side) => layout.members[side].length > 0);

/** ELK ports of a card: one per side with pins, centred on its height. */
export function archPorts(instancePath: string, layout: ArchLayout, width: number): ElkPort[] {
  return portedSides(layout).map((side) => ({
    id: portId(instancePath, archPortName(side)),
    x: side === 'west' ? -PORT_SIZE / 2 : width - PORT_SIZE / 2,
    y: (layout.height - PORT_SIZE) / 2,
    width: PORT_SIZE,
    height: PORT_SIZE,
  }));
}

/** Port id of every pin of the card, mapped to the port of its side. */
export function archPinPorts(instancePath: string, layout: ArchLayout): Map<string, string> {
  const ports = new Map<string, string>();
  for (const side of portedSides(layout)) {
    for (const pin of layout.members[side]) {
      ports.set(portId(instancePath, pin), portId(instancePath, archPortName(side)));
    }
  }
  return ports;
}

/** Centre y and side of each port of the card, by port name. */
export function archPortCentres(layout: ArchLayout): Map<string, PortSpot> {
  return new Map(
    portedSides(layout).map((side) => [
      archPortName(side),
      { y: layout.height / 2, side } satisfies PortSpot,
    ])
  );
}
