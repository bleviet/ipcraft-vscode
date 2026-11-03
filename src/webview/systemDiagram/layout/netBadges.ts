/**
 * Net-name badges for pins of hidden clock and reset nets. The badge text and
 * size are reserved in the ELK graph as OUTSIDE port labels so ELK keeps room
 * for them; the label position ELK returns is where the badge is drawn.
 */

import type { ElkLabel, ElkPort } from 'elkjs/lib/elk-api';
import type { NetCategory, PinRef, SystemGraph, SystemNet } from '../../../domain/systemGraph';
import { endpointKey, isClockOrReset, netsOfLevel } from '../model';

export const BADGE_MAX_CHARS = 24;
const BADGE_CHAR_WIDTH = 6.5;
const BADGE_PADDING = 12;
const BADGE_HEIGHT = 14;
const BADGE_ID_PREFIX = 'badge:';

export interface NetBadge {
  netId: string;
  netName: string;
  category: NetCategory;
  text: string;
  /** Position relative to the owning node, as reserved by ELK. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export function badgeText(netName: string): string {
  return netName.length > BADGE_MAX_CHARS ? `${netName.slice(0, BADGE_MAX_CHARS)}…` : netName;
}

/** Nets whose wires are omitted, keyed by {@link endpointKey}; empty when shown. */
export function hiddenNetsByEndpoint(
  graph: SystemGraph,
  levelPath: string,
  showClockReset: boolean
): Map<string, SystemNet> {
  const lookup = new Map<string, SystemNet>();
  if (showClockReset) {
    return lookup;
  }
  for (const net of netsOfLevel(graph, levelPath).filter(isClockOrReset)) {
    for (const ref of net.endpoints) {
      lookup.set(endpointKey(ref), net);
    }
  }
  return lookup;
}

export function badgeLabel(net: SystemNet): ElkLabel {
  const text = badgeText(net.name);
  return {
    id: `${BADGE_ID_PREFIX}${net.id}`,
    text,
    width: Math.ceil(text.length * BADGE_CHAR_WIDTH + BADGE_PADDING),
    height: BADGE_HEIGHT,
  };
}

export function badgeLabels(
  hidden: ReadonlyMap<string, SystemNet>,
  ref: PinRef
): ElkLabel[] | undefined {
  const net = hidden.get(endpointKey(ref));
  return net ? [badgeLabel(net)] : undefined;
}

/** Reads back the badge ELK placed for a port; label x is port-relative. */
export function badgeOfPort(port: ElkPort | undefined, graph: SystemGraph): NetBadge | undefined {
  const label = port?.labels?.[0];
  if (!port || !label?.id?.startsWith(BADGE_ID_PREFIX)) {
    return undefined;
  }
  const netId = label.id.slice(BADGE_ID_PREFIX.length);
  const net = graph.nets.find((candidate) => candidate.id === netId);
  if (!net) {
    return undefined;
  }
  const height = label.height ?? BADGE_HEIGHT;
  return {
    netId,
    netName: net.name,
    category: net.category,
    text: label.text ?? net.name,
    x: (port.x ?? 0) + (label.x ?? 0),
    // ELK puts the label just below the port; centre it on the pin row instead
    // so the badge reads as that pin's label. It stays in the reserved column.
    y: (port.y ?? 0) + (port.height ?? 0) / 2 - height / 2,
    width: label.width ?? 0,
    height,
  };
}
