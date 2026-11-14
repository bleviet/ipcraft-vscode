/**
 * What a comparison adds to the current graph to draw what it removed (issue #302): the blocks,
 * pins, external ports and wires that only the base has, as ghosts. The viewer lays out the union
 * of both graphs (the current graph plus these additions), so a ghost sits where its neighbours
 * pull it. Pure: no `vscode`, no DOM.
 *
 * The additions are computed on the base after the diff's renames and moves are applied, so a
 * renamed or moved block is the block it is in the current graph, never a ghost, and a ghost
 * carries the names and levels the current graph uses.
 */

import type {
  PinRef,
  SystemGraph,
  SystemInstance,
  SystemNet,
  SystemPin,
} from '../../../domain/systemGraph';
import type { SystemGraphDiff, UnionAdditions } from '../../../domain/systemGraphDiff';
import { findingsBase } from './diffFindings';
import { buildPeerLookup, instancePin, parentLevel, pinKey, ROOT, type PinId } from './pinPeers';
import { relocateInstances } from './relocate';

/** Prefix of the id of a net that only the base has; no net of a design has it. */
export const GHOST_NET_PREFIX = 'ghost:';

/** Whether there is anything to draw. */
export const hasAdditions = (union: UnionAdditions): boolean =>
  union.instances.length + union.pins.length + union.boundaryPins.length + union.nets.length > 0;

/** `renamedBase` (the base with the renames of `diff` applied) with the moves of `diff` applied, as the diff compared it. */
function relocatedBase(renamedBase: SystemGraph, diff: SystemGraphDiff): SystemGraph {
  const moves = new Map(
    diff.instances.flatMap((change) =>
      change.status === 'moved' && change.basePath !== undefined
        ? [[change.basePath, change.path] as const]
        : []
    )
  );
  return moves.size > 0 ? relocateInstances(renamedBase, moves) : renamedBase;
}

const isClockOrResetNet = (net: SystemNet): boolean =>
  net.category === 'clock' || net.category === 'reset';

/**
 * The pins of `ids` that `peers` still connects, as a group number per pin: the index of the
 * first pin of its group.
 */
function connectedGroups(ids: readonly PinId[], peers: (id: PinId) => PinId[]): number[] {
  const parent = ids.map((_, index) => index);
  const find = (index: number): number =>
    parent[index] === index ? index : (parent[index] = find(parent[index]));
  const indexOf = new Map(ids.map((id, index) => [pinKey(id), index]));
  ids.forEach((id, index) => {
    for (const peer of peers(id)) {
      const other = indexOf.get(pinKey(peer));
      if (other !== undefined) {
        parent[Math.max(find(index), find(other))] = Math.min(find(index), find(other));
      }
    }
  });
  return ids.map((_, index) => find(index));
}

/**
 * The ghosts of a comparison. `renamedBase` is `findingsBase(base, diff)`; pass it when the caller
 * has it already (the findings use it too).
 *
 * - `instances`: the removed blocks (status `removed` in `diff`) whose level exists in `current`.
 *   Only the topmost block of a removed subtree is a ghost: a removed hierarchy is one block, and
 *   what was inside it is not drawn.
 * - `boundaryPins`: the removed external ports (`diff.ports`). A removed pin of a hierarchy is
 *   not one: it has no node on the level it belongs to.
 * - `nets`: the connections of the base that `current` no longer has. A base net on a level that
 *   exists in `current` is cut to the pins that exist in the union (a pin of a block of
 *   `current` or of a ghost, a pin the base had on a block of `current`, a boundary pin of
 *   `current` or a ghost port), and those pins are grouped by what `current` still connects (the
 *   pin peers of the current graph). A net whose pins are one group lost nothing. Otherwise one
 *   ghost net is added, with the first pin of each group, so the old connection between the
 *   groups is drawn once and the connections that `current` keeps are not drawn twice. Clock and
 *   reset nets are left out: the viewer draws them as badges and routes them separately, and the
 *   Changes tab lists what changed in them. The id is the base net's, prefixed with
 *   {@link GHOST_NET_PREFIX}.
 * - `pins`: the pins of those nets that a block of `current` does not have any more (the
 *   interconnect port of a removed slave, say), so the ghost wire has an end to meet.
 */
export function unionAdditions(
  base: SystemGraph,
  current: SystemGraph,
  diff: SystemGraphDiff,
  renamedBase: SystemGraph = findingsBase(base, diff)
): UnionAdditions {
  const moved = relocatedBase(renamedBase, diff);
  const removedPaths = new Set(
    diff.instances.filter((change) => change.status === 'removed').map((change) => change.path)
  );
  const ghosts = new Map<string, SystemInstance>();
  for (const path of removedPaths) {
    const instance = moved.instances[path];
    if (instance && !removedPaths.has(instance.parent) && current.levels[instance.parent]) {
      ghosts.set(path, instance);
    }
  }
  const ports = diff.ports.flatMap((change) => {
    const pin =
      change.status === 'removed'
        ? moved.levels[ROOT].boundaryPins.find((candidate) => candidate.name === change.pin)
        : undefined;
    return pin ? [{ level: ROOT, pin }] : [];
  });

  /** The pin `ref` names in the union, and whether it is one only the base has on a block of `current`. */
  const resolve = (
    ref: PinRef,
    level: string
  ): { pin: SystemPin; ofCurrent: boolean } | undefined => {
    if (ref.instance === null) {
      const named = (candidate: SystemPin) => candidate.name === ref.pin;
      const pin =
        current.levels[level].boundaryPins.find(named) ??
        (level === ROOT ? ports.find((port) => named(port.pin))?.pin : undefined);
      return pin ? { pin, ofCurrent: false } : undefined;
    }
    const ghost = ghosts.get(ref.instance);
    const instance = ghost ?? current.instances[ref.instance];
    if (!instance || parentLevel(instance.path) !== level) {
      return undefined;
    }
    const named = (candidate: SystemPin) => candidate.name === ref.pin;
    const pin = instance.pins.find(named);
    if (pin || ghost) {
      return pin && { pin, ofCurrent: false };
    }
    const only = moved.instances[ref.instance]?.pins.find(named);
    return only && { pin: only, ofCurrent: true };
  };

  const peers = buildPeerLookup(current);
  const nets: SystemNet[] = [];
  const pins = new Map<string, { instance: string; pin: SystemPin }>();
  for (const net of moved.nets) {
    if (!current.levels[net.level] || isClockOrResetNet(net)) {
      continue;
    }
    const known = net.endpoints.flatMap((ref) => {
      const found = resolve(ref, net.level);
      return found ? [{ ref, ...found }] : [];
    });
    const ids = known.map(({ ref }) =>
      ref.instance === null
        ? { instance: null, level: net.level, pin: ref.pin }
        : instancePin(ref.instance, ref.pin)
    );
    const groups = connectedGroups(ids, peers);
    const firsts = known.filter((_, index) => groups[index] === index);
    if (firsts.length < 2) {
      continue;
    }
    nets.push({ ...net, id: `${GHOST_NET_PREFIX}${net.id}`, endpoints: firsts.map((f) => f.ref) });
    for (const { ref, pin, ofCurrent } of firsts) {
      if (ofCurrent && ref.instance !== null) {
        pins.set(pinKey(instancePin(ref.instance, ref.pin)), { instance: ref.instance, pin });
      }
    }
  }
  return { instances: [...ghosts.values()], pins: [...pins.values()], boundaryPins: ports, nets };
}
