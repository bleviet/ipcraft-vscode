/**
 * Net-name badges for pins of hidden clock and reset nets. The badge text and
 * size are reserved in the ELK graph as OUTSIDE port labels so ELK keeps room
 * for them; the label position ELK returns is where the badge is drawn.
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
  /** Every hidden net of the pin, in graph order; the first is `netId`. */
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

/** Nets whose wires are omitted, keyed by {@link endpointKey}; empty when shown. */
export function hiddenNetsByEndpoint(
  graph: SystemGraph,
  levelPath: string,
  showClockReset: boolean
): Map<string, SystemNet[]> {
  const lookup = new Map<string, SystemNet[]>();
  if (showClockReset) {
    return lookup;
  }
  for (const net of netsOfLevel(graph, levelPath).filter(isClockOrReset)) {
    for (const ref of net.endpoints) {
      const key = endpointKey(ref);
      lookup.set(key, [...(lookup.get(key) ?? []), net]);
    }
  }
  return lookup;
}

/** One badge per pin: the first hidden net's name, plus ` +N` for the others. */
export function badgeLabel(graph: SystemGraph, nets: readonly SystemNet[], ref: PinRef): ElkLabel {
  const driver = sourceInstance(graph, nets[0]);
  const name = shortNetName(nets[0].name, driver ? graph.instances[driver]?.name : undefined);
  const text = badgeText(name, nets.length - 1);
  return {
    id: `${BADGE_ID_PREFIX}${endpointKey(ref)}`,
    text,
    width: Math.ceil(text.length * BADGE_CHAR_WIDTH + BADGE_PADDING),
    height: BADGE_HEIGHT,
  };
}

export function badgeLabels(
  graph: SystemGraph,
  hidden: ReadonlyMap<string, readonly SystemNet[]>,
  ref: PinRef
): ElkLabel[] | undefined {
  const nets = hidden.get(endpointKey(ref));
  return nets ? [badgeLabel(graph, nets, ref)] : undefined;
}

/**
 * Reads back the badge ELK placed for a port; label x is port-relative. The
 * label carries geometry only: `nets` are the pin's hidden nets.
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
