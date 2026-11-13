/** Which pins share a net with a pin: the identity of a connection in a diff (net names and ids are not). */

import type { PinRef, SystemGraph } from '../../../domain/systemGraph';
import { compareText } from './compareText';

export const ROOT = '/';

/**
 * A pin by identity. An instance pin is its absolute instance path and name, whatever level
 * the net naming it belongs to; a boundary pin (`instance: null`) is its level and name.
 */
export interface PinId {
  instance: string | null;
  /** The level the pin sits on: the level that contains the instance, or the boundary pin's own level. */
  level: string;
  pin: string;
}

/**
 * `baseName`: set on the lookup of the base graph after renamed blocks were applied to it; it
 * gives the path a block had in the base revision, for labels only (identity uses the renamed paths).
 */
export type PeerLookup = ((id: PinId) => PinId[]) & { baseName?: (path: string) => string };

/** The level that contains the instance at `path`. */
export function parentLevel(path: string): string {
  return path.slice(0, path.lastIndexOf('/')) || ROOT;
}

export function instancePin(instance: string, pin: string): PinId {
  return { instance, level: parentLevel(instance), pin };
}

export function pinKey(id: PinId): string {
  return id.instance !== null
    ? `i\u0000${id.instance}\u0000${id.pin}`
    : `b\u0000${id.level}\u0000${id.pin}`;
}

/**
 * How a peer is written when reporting a pin on `view`: `instanceName/pin` for an instance
 * of that level, `pin` for its boundary pin, otherwise the absolute `/instance/path/pin`, or for a boundary
 * pin of another level `/level/path:pin` (a root port is `/pin`).
 */
export function peerLabel(peer: PinId, view: string, name = (path: string) => path): string {
  if (peer.instance !== null) {
    const path = name(peer.instance);
    return peer.level === view
      ? `${path.slice(path.lastIndexOf('/') + 1)}/${peer.pin}`
      : `${path}/${peer.pin}`;
  }
  if (peer.level === view) {
    return peer.pin;
  }
  return peer.level === ROOT ? `/${peer.pin}` : `${name(peer.level)}:${peer.pin}`;
}

/** The labels of `peers` as seen from `view`, sorted; `name` gives the path to write for an instance or level. */
export function peerLabels(
  peers: PinId[],
  view: string,
  name?: (path: string) => string
): string[] {
  return peers.map((p) => peerLabel(p, view, name)).sort(compareText);
}

/**
 * Indexes the nets of `graph` once. The lookup returns the other endpoints of every net,
 * on any level, that holds the pin, deduplicated.
 */
export function buildPeerLookup(graph: SystemGraph): PeerLookup {
  const peers = new Map<string, Map<string, PinId>>();
  const idOf = (ref: PinRef, level: string): PinId =>
    ref.instance === null
      ? { instance: null, level, pin: ref.pin }
      : instancePin(ref.instance, ref.pin);
  for (const net of graph.nets) {
    const ids = net.endpoints.map((ref) => idOf(ref, net.level));
    for (const id of ids) {
      const key = pinKey(id);
      let set = peers.get(key);
      if (!set) {
        set = new Map();
        peers.set(key, set);
      }
      for (const other of ids) {
        if (pinKey(other) !== key) {
          set.set(pinKey(other), other);
        }
      }
    }
  }
  return (id) => [...(peers.get(pinKey(id))?.values() ?? [])];
}
