/**
 * Instance blocks (collapsed blocks) between the graph and ELK / React Flow:
 * the rows of each side (pins, or folded pin arrays), the block size, the ELK
 * node with one fixed-position port per row, and the pin rows drawn after layout.
 */

import type { ElkNode, ElkPort } from 'elkjs/lib/elk-api';
import type { SystemGraph, SystemInstance } from '../../../domain/systemGraph';
import { cellCount, endpointKey, instanceSubtitle, type netsByEndpoint } from '../model';
import {
  archLayout,
  archPinPorts,
  archPortCentres,
  archPorts,
  archPillsWidth,
  type ArchLayout,
} from './archCard';
import type { InstanceNodeData, PinRow, PinSide } from './diagramTypes';
import { portId } from './levelEdges';
import { badgeOfPort, type BadgeLabels, type clockResetNetsByEndpoint } from './netBadges';
import {
  CHEVRON_WIDTH,
  INSTANCE_MAX_WIDTH,
  INSTANCE_MIN_WIDTH,
  instanceLayout,
  type InstanceLayout,
  type SizedRow,
  type TextMeasure,
} from './nodeSizing';
import type { PortSpot } from './edgeBundling';
import { foldSide, rowName, type PinFolding, type SideRow } from './pinGrouping';
import { HEADER_HEIGHT, PIN_ROW_HEIGHT, PORT_SIZE, groupRow, pinRow, splitSides } from './pinRows';

type ClockResetNets = ReturnType<typeof clockResetNetsByEndpoint>;
type NetLookup = ReturnType<typeof netsByEndpoint>;

/** The rows of each side; an Arch card has none and holds its `arch` layout instead. */
export type InstanceRows = Record<PinSide, SideRow[]> & { arch?: ArchLayout };

/** What an Arch card is built from: the graph (for the hierarchy preview) and the nets of the instance's level. */
export interface ArchContext {
  graph: SystemGraph;
  nets: NetLookup;
}

/** Port top below its row top: 1 px border + 9 px row middle - half the 8 px port. */
const PIN_TOP_OFFSET = 6;
const PIN_BOTTOM_PADDING = 10;
/** Port y within a block, by row index. */
const portTop = (index: number) => HEADER_HEIGHT + index * PIN_ROW_HEIGHT + PIN_TOP_OFFSET;

export const PORT_LABEL_OPTIONS = { 'org.eclipse.elk.portLabels.placement': 'OUTSIDE' };

/**
 * The rows of each side. Without `folding` every pin is a row. Pins of clock and
 * reset nets never fold: their badges are reserved as labels of their own ports.
 * With `folding.arch` (and its `arch` context) the block is a card, not rows.
 */
export function instanceRows(
  instance: SystemInstance,
  clockReset: ClockResetNets,
  folding?: PinFolding,
  arch?: ArchContext
): InstanceRows {
  if (folding?.arch && arch) {
    return { west: [], east: [], arch: archLayout(arch.graph, instance, arch.nets) };
  }
  const sides = splitSides(instance.pins);
  const fold = (side: PinSide): SideRow[] =>
    folding
      ? foldSide(
          sides[side],
          (pin) => clockReset.has(endpointKey({ instance: instance.path, pin: pin.name })),
          (groupId) => folding.open.has(portId(instance.path, groupId))
        )
      : sides[side].map((pin) => ({ kind: 'pin', pin }));
  return { west: fold('west'), east: fold('east') };
}

/** Port id of every pin inside a folded group (or an Arch card), mapped to the port that draws it. */
export function foldedPorts(instance: SystemInstance, rows: InstanceRows): Map<string, string> {
  if (rows.arch) {
    return archPinPorts(instance.path, rows.arch);
  }
  const ports = new Map<string, string>();
  for (const row of [...rows.west, ...rows.east]) {
    if (row.kind === 'folded') {
      for (const member of row.group.members) {
        ports.set(portId(instance.path, member.name), portId(instance.path, row.group.id));
      }
    }
  }
  return ports;
}

/** Centre y and side of each port of a block within it, by port name. */
export function portCentres(rows: InstanceRows): Map<string, PortSpot> {
  if (rows.arch) {
    return archPortCentres(rows.arch);
  }
  const centres = new Map<string, PortSpot>();
  for (const side of ['west', 'east'] as const) {
    rows[side].forEach((row, index) => {
      if (row.kind !== 'header') {
        centres.set(rowName(row), { y: portTop(index) + PORT_SIZE / 2, side });
      }
    });
  }
  return centres;
}

export function instanceHeight(rows: InstanceRows): number {
  return rows.arch
    ? rows.arch.height
    : HEADER_HEIGHT +
        Math.max(rows.west.length, rows.east.length) * PIN_ROW_HEIGHT +
        PIN_BOTTOM_PADDING;
}

function sizedRows(rows: readonly SideRow[]): SizedRow[] {
  return rows.map((row) =>
    row.kind === 'pin'
      ? { name: row.pin.name }
      : { name: row.group.id, text: row.group.label, extra: CHEVRON_WIDTH }
  );
}

export function sizeOfInstance(
  graph: SystemGraph,
  instance: SystemInstance,
  rows: InstanceRows,
  measure: TextMeasure
): InstanceLayout {
  const layout = instanceLayout(
    instance,
    { west: sizedRows(rows.west), east: sizedRows(rows.east) },
    instanceSubtitle(instance, cellCount(graph, instance.path)),
    measure
  );
  if (!rows.arch) {
    return layout;
  }
  // A card also makes room for its pills, within the usual bounds.
  const width = Math.ceil(
    Math.min(
      INSTANCE_MAX_WIDTH,
      Math.max(INSTANCE_MIN_WIDTH, layout.width, archPillsWidth(rows.arch.summary, measure))
    )
  );
  return { ...layout, width };
}

/** ELK node of an instance block: a port per pin row and per folded group row, or per side of a card. */
export function instanceNode(
  instance: SystemInstance,
  rows: InstanceRows,
  width: number,
  badges: BadgeLabels
): ElkNode {
  const ports: ElkPort[] = rows.arch
    ? archPorts(instance.path, rows.arch, width)
    : (['west', 'east'] as const).flatMap((side) =>
        rows[side].flatMap((row, index) =>
          row.kind === 'header'
            ? []
            : [
                {
                  id: portId(instance.path, rowName(row)),
                  x: side === 'west' ? -PORT_SIZE / 2 : width - PORT_SIZE / 2,
                  y: portTop(index),
                  width: PORT_SIZE,
                  height: PORT_SIZE,
                  labels:
                    row.kind === 'pin'
                      ? badges({ instance: instance.path, pin: row.pin.name })
                      : undefined,
                },
              ]
        )
      );
  return {
    id: instance.path,
    width,
    height: instanceHeight(rows),
    layoutOptions: { 'org.eclipse.elk.portConstraints': 'FIXED_POS', ...PORT_LABEL_OPTIONS },
    ports,
  };
}

/** The pin rows drawn on a laid-out instance block; `labels` come from {@link sizeOfInstance}. */
export function flowPinRows(
  instance: SystemInstance,
  rows: InstanceRows,
  netLookup: NetLookup,
  ports: ReadonlyMap<string, ElkPort>,
  clockReset: ClockResetNets,
  labels: ReadonlyMap<string, string>
): Pick<InstanceNodeData, 'west' | 'east'> {
  const netsOf = (pinName: string) =>
    netLookup.get(endpointKey({ instance: instance.path, pin: pinName })) ?? [];
  const drawn = (row: SideRow): PinRow => {
    if (row.kind === 'pin') {
      const ref = { instance: instance.path, pin: row.pin.name };
      return pinRow(
        row.pin,
        netsOf(row.pin.name),
        labels.get(row.pin.name)!,
        badgeOfPort(
          ports.get(portId(instance.path, row.pin.name)),
          clockReset.get(endpointKey(ref))
        )
      );
    }
    const members = row.group.members.map((pin) =>
      pinRow(pin, netsOf(pin.name), pin.name, undefined)
    );
    return groupRow(
      row.group.id,
      row.group.label,
      labels.get(row.group.id)!,
      row.kind === 'header',
      members
    );
  };
  return { west: rows.west.map(drawn), east: rows.east.map(drawn) };
}
