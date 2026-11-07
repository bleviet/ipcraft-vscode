/**
 * Net-name badges for pins of clock and reset nets, drawn in place of those
 * nets' wires while the wires are off. The badge text and size are always
 * reserved in the ELK graph as OUTSIDE port labels, so the layout is the same
 * whether the wires or the badges are drawn; the label position ELK returns is
 * where the badge is drawn.
 */

import type { ElkLabel, ElkPort } from 'elkjs/lib/elk-api';
import type { NetCategory, PinRef, SystemGraph, SystemNet } from '../../../domain/systemGraph';
import { endpointKey, isClockOrReset, netsOfLevel, pinRole, resolvePin } from '../model';

export const BADGE_MAX_CHARS = 24;
export const BADGE_CHAR_WIDTH = 6.5;
const BADGE_PADDING = 12;
const BADGE_HEIGHT = 14;
const BADGE_ID_PREFIX = 'badge:';

export interface NetBadge {
  netId: string;
  netName: string;
  category: NetCategory;
  /** Every clock and reset net of the pin, in graph order; the first is `netId`. */
  nets: { id: string; name: string; category: NetCategory }[];
  text: string;
  /** Position relative to the owning node, as reserved by ELK. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export function badgeText(netName: string, extra = 0): string {
  const name = netName.length > BADGE_MAX_CHARS ? `${netName.slice(0, BADGE_MAX_CHARS)}…` : netName;
  return extra > 0 ? `${name} +${extra}` : name;
}

/**
 * Badge name of a net: Vivado names a net after its driver instance
 * (`rst_ps7_0_100M_peripheral_aresetn`), so the instance prefix is dropped.
 * The full name stays in the tooltip.
 */
export function shortNetName(netName: string, driverName: string | undefined): string {
  const prefix = driverName ? `${driverName}_` : undefined;
  return prefix && netName.startsWith(prefix) && netName.length > prefix.length
    ? netName.slice(prefix.length)
    : netName;
}

/**
 * Path of the instance that drives the net: the first instance pin with the
 * source role. Vivado scripts leave most pin directions unknown, so when there
 * is no known source and the first endpoint is an instance pin of unknown
 * direction, it stands in (Vivado lists the driver first). A net whose first
 * endpoint is a known sink or a boundary port has none.
 */
export function sourceInstance(graph: SystemGraph, net: SystemNet): string | undefined {
  const roles = net.endpoints.map((ref) => {
    const pin = resolvePin(graph, net.level, ref);
    return pin ? pinRole(pin, ref.instance === null) : 'none';
  });
  const source = net.endpoints.find(
    (ref, index) => roles[index] === 'source' && ref.instance !== null
  );
  if (source) {
    return source.instance ?? undefined;
  }
  const first = net.endpoints[0];
  return first?.instance !== null && roles[0] === 'none' ? first?.instance : undefined;
}

/** The clock and reset nets of the level, whose wires can be off, keyed by {@link endpointKey}. */
export function clockResetNetsByEndpoint(
  graph: SystemGraph,
  levelPath: string
): Map<string, SystemNet[]> {
  const lookup = new Map<string, SystemNet[]>();
  for (const net of netsOfLevel(graph, levelPath).filter(isClockOrReset)) {
    for (const ref of net.endpoints) {
      const key = endpointKey(ref);
      lookup.set(key, [...(lookup.get(key) ?? []), net]);
    }
  }
  return lookup;
}

/** The badge labels of a pin of one level: one label, or none off clock and reset nets. */
export type BadgeLabels = (ref: PinRef) => ElkLabel[] | undefined;

/**
 * Badge labels of the pins of one level. One badge per pin: the first net's
 * name, plus ` +N` for the others. Finding a net's driver reads every endpoint
 * of the net, so each net's name is worked out once, not once per pin.
 */
export function levelBadgeLabels(
  graph: SystemGraph,
  clockReset: ReadonlyMap<string, readonly SystemNet[]>
): BadgeLabels {
  const names = new Map<SystemNet, string>();
  const nameOf = (net: SystemNet): string => {
    let name = names.get(net);
    if (name === undefined) {
      const driver = sourceInstance(graph, net);
      name = shortNetName(net.name, driver ? graph.instances[driver]?.name : undefined);
      names.set(net, name);
    }
    return name;
  };
  return (ref) => {
    const nets = clockReset.get(endpointKey(ref));
    if (!nets) {
      return undefined;
    }
    const text = badgeText(nameOf(nets[0]), nets.length - 1);
    return [
      {
        id: `${BADGE_ID_PREFIX}${endpointKey(ref)}`,
        text,
        width: Math.ceil(text.length * BADGE_CHAR_WIDTH + BADGE_PADDING),
        height: BADGE_HEIGHT,
      },
    ];
  };
}

/**
 * Reads back the badge ELK placed for a port; label x is port-relative. The
 * label carries geometry only: `nets` are the pin's clock and reset nets.
 */
export function badgeOfPort(
  port: ElkPort | undefined,
  nets: readonly SystemNet[] | undefined
): NetBadge | undefined {
  const label = port?.labels?.[0];
  if (!port || !label?.id?.startsWith(BADGE_ID_PREFIX) || !nets?.[0]) {
    return undefined;
  }
  const net = nets[0];
  const height = label.height ?? BADGE_HEIGHT;
  return {
    netId: net.id,
    netName: net.name,
    category: net.category,
    nets: nets.map(({ id, name, category }) => ({ id, name, category })),
    text: label.text ?? net.name,
    x: (port.x ?? 0) + (label.x ?? 0),
    // ELK puts the label just below the port; centre it on the pin row instead
    // so the badge reads as that pin's label. It stays in the reserved column.
    y: (port.y ?? 0) + (port.height ?? 0) / 2 - height / 2,
    width: label.width ?? 0,
    height,
  };
}
