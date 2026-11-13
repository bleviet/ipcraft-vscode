/**
 * Pin changes. The principle: report the pin that moved, not the pins it joined or left,
 * and not a pin whose peers differ only by the pins of added or removed blocks.
 */

import type { SystemGraph } from '../../../domain/systemGraph';
import type { PinChange, ValueChange } from '../../../domain/systemGraphDiff';
import { compareText } from './compareText';
import {
  ROOT,
  buildPeerLookup,
  instancePin,
  peerLabels,
  pinKey,
  type PeerLookup,
  type PinId,
} from './pinPeers';

export interface PinContext {
  base: PeerLookup;
  current: PeerLookup;
  /** Paths of the instances (and `port:<name>` of the external ports) that exist in the current graph only. */
  added: Set<string>;
  /** The same for the base graph only. */
  removed: Set<string>;
  /** Keys (`pinKey`) of the inside views of hierarchy pins that the diff classifies. */
  inside: Set<string>;
}

/** The hierarchy pins whose inside view is classified: pins of an instance that is a hierarchy on at least one side. */
function insidePins(base: SystemGraph, current: SystemGraph): { owner: string; pins: string[] }[] {
  const result: { owner: string; pins: string[] }[] = [];
  for (const [path, b] of Object.entries(base.instances)) {
    const c = current.instances[path];
    if (c && (b.kind === 'hier' || c.kind === 'hier')) {
      const names = [
        ...(b.kind === 'hier' ? b.pins : []),
        ...(c.kind === 'hier' ? c.pins : []),
      ].map((p) => p.name);
      result.push({ owner: path, pins: [...new Set(names)] });
    }
  }
  return result;
}

function ownerKeys(graph: SystemGraph): Set<string> {
  return new Set([
    ...Object.keys(graph.instances),
    ...graph.levels[ROOT].boundaryPins.map((p) => `port:${p.name}`),
  ]);
}

export function createPinContext(
  base: SystemGraph,
  current: SystemGraph,
  baseName?: (path: string) => string
): PinContext {
  const [baseOwners, currentOwners] = [ownerKeys(base), ownerKeys(current)];
  const only = (a: Set<string>, b: Set<string>) => new Set([...a].filter((k) => !b.has(k)));
  return {
    base: Object.assign(buildPeerLookup(base), { baseName }),
    current: buildPeerLookup(current),
    added: only(currentOwners, baseOwners),
    removed: only(baseOwners, currentOwners),
    inside: new Set(
      insidePins(base, current).flatMap(({ owner, pins }) =>
        pins.map((pin) => pinKey({ instance: null, level: owner, pin }))
      )
    ),
  };
}

/** Whether the peer is a pin of an owner in `owners` (boundary pins count only on the root level). */
function isOwnedBy(owners: Set<string>, peer: PinId): boolean {
  if (peer.instance !== null) {
    return owners.has(peer.instance);
  }
  return peer.level === ROOT && owners.has(`port:${peer.pin}`);
}

/**
 * Whether the diff classifies the pin: an instance pin, an external port, or the inside view
 * of a pin of a hierarchy. The remaining endpoints (a boundary pin of a level that is not a
 * hierarchy on either side) are not classified and never suppress a pin.
 */
function isClassified(ctx: PinContext, peer: PinId): boolean {
  return peer.instance !== null || peer.level === ROOT || ctx.inside.has(pinKey(peer));
}

const isPort = (id: PinId): boolean => id.instance === null && id.level === ROOT;

function keptCount(ctx: PinContext, peer: PinId): number {
  const current = new Set(ctx.current(peer).map(pinKey));
  return ctx.base(peer).filter((p) => current.has(pinKey(p))).length;
}

/**
 * The change of one pin, or undefined when there is none worth reporting. `differs`: the
 * pin has another change (an attribute) that makes it `changed` although its peers do not.
 */
export function classifyPin(
  ctx: PinContext,
  id: PinId,
  exists: { base: boolean; current: boolean },
  differs = false
): PinChange | undefined {
  const pin = id.pin;
  const base = exists.base ? ctx.base(id) : undefined;
  const current = exists.current ? ctx.current(id) : undefined;
  if (!current || !base) {
    // A port is always reported; an instance pin only when something else than an added or
    // removed block is on its nets.
    const peers = base ?? current ?? [];
    const explained = current ? ctx.added : ctx.removed;
    if (!isPort(id) && peers.length > 0 && peers.every((p) => isOwnedBy(explained, p))) {
      return undefined;
    }
    return current
      ? { pin, status: 'added', currentPeers: peerLabels(current, id.level) }
      : { pin, status: 'removed', basePeers: peerLabels(base ?? [], id.level, ctx.base.baseName) };
  }
  const [baseKeys, currentKeys] = [new Set(base.map(pinKey)), new Set(current.map(pinKey))];
  const kept = base.filter((p) => currentKeys.has(pinKey(p)));
  const remaining = [
    ...current.filter((p) => !baseKeys.has(pinKey(p)) && !isOwnedBy(ctx.added, p)),
    ...base.filter((p) => !currentKeys.has(pinKey(p)) && !isOwnedBy(ctx.removed, p)),
  ];
  // Host rule. P is a host that merely gained or lost a neighbour when it kept connections
  // and every pin Q that joined or left kept fewer of its own. Every net endpoint is a
  // classified pin (an instance pin, an external port, or the inside view of a hierarchy
  // pin), so two pins on opposite sides of a change are never both suppressed: each
  // suppression needs the other side to be classified with a smaller kept set. An endpoint
  // that is not classified never suppresses.
  const suppressed =
    remaining.length === 0 ||
    (kept.length > 0 &&
      remaining.every((q) => isClassified(ctx, q) && keptCount(ctx, q) < kept.length));
  if (suppressed && !differs) {
    return undefined;
  }
  // Equal peers (the pin changed by an attribute) are written alike on both sides.
  const samePeers = baseKeys.size === currentKeys.size && kept.length === baseKeys.size;
  return {
    pin,
    status: 'changed',
    basePeers: peerLabels(base, id.level, samePeers ? undefined : ctx.base.baseName),
    currentPeers: peerLabels(current, id.level),
  };
}

/**
 * Changes of the pins of one instance, sorted by pin name. `attributes`, for hierarchies,
 * compares a pin that exists on both sides; the result then carries the differences
 * (possibly none) and a difference makes the pin `changed`.
 */
export function diffPins(
  ctx: PinContext,
  owner: string,
  baseNames: string[],
  currentNames: string[],
  attributes?: (pin: string) => ValueChange[]
): PinChange[] {
  const [inBase, inCurrent] = [new Set(baseNames), new Set(currentNames)];
  const changes: PinChange[] = [];
  for (const pin of [...new Set([...inBase, ...inCurrent])].sort(compareText)) {
    const both = inBase.has(pin) && inCurrent.has(pin);
    const diffs = both && attributes ? attributes(pin) : undefined;
    const change = classifyPin(
      ctx,
      instancePin(owner, pin),
      { base: inBase.has(pin), current: inCurrent.has(pin) },
      (diffs?.length ?? 0) > 0
    );
    if (change) {
      changes.push(diffs ? { ...change, attributes: diffs } : change);
    }
  }
  return changes;
}

/**
 * Changes of the inside views of the pins of a hierarchy (their connections on the
 * hierarchy's own level), as pins with `inside`. A pin on one side only is listed when it
 * has inside peers that are not explained.
 */
export function diffInsidePins(
  ctx: PinContext,
  owner: string,
  baseNames: string[],
  currentNames: string[]
): PinChange[] {
  const [inBase, inCurrent] = [new Set(baseNames), new Set(currentNames)];
  const changes: PinChange[] = [];
  for (const pin of [...new Set([...inBase, ...inCurrent])].sort(compareText)) {
    const change = classifyPin(
      ctx,
      { instance: null, level: owner, pin },
      {
        base: inBase.has(pin),
        current: inCurrent.has(pin),
      }
    );
    const peers = change?.basePeers ?? change?.currentPeers ?? [];
    if (change && (change.status === 'changed' || peers.length > 0)) {
      changes.push({ ...change, inside: true });
    }
  }
  return changes;
}

/** The connected pins of an instance that exists in one graph only, sorted by pin name. */
export function connectedPins(
  lookup: PeerLookup,
  status: 'added' | 'removed',
  owner: string,
  pinNames: string[]
): PinChange[] {
  const changes: PinChange[] = [];
  for (const pin of [...new Set(pinNames)].sort(compareText)) {
    const id = instancePin(owner, pin);
    const peers = peerLabels(lookup(id), id.level, lookup.baseName);
    if (peers.length > 0) {
      changes.push(
        status === 'added'
          ? { pin, status, currentPeers: peers }
          : { pin, status, basePeers: peers }
      );
    }
  }
  return changes;
}
