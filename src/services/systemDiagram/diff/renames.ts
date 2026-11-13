/**
 * Renamed blocks. A block is identified by its path, so a rename is one removed and one added
 * block. The rule is conservative, because a wrong rename hides a real change: it pairs only
 * a block that is identical under both names, and only when no other candidate could be it.
 * Pure: no `vscode`, no DOM.
 */

import type {
  AddressSegment,
  SystemGraph,
  SystemInstance,
  SystemLevel,
  SystemNet,
} from '../../../domain/systemGraph';
import type { InstanceChange, SystemGraphDiff } from '../../../domain/systemGraphDiff';
import { compareText } from './compareText';
import { instanceType } from './diffInstances';
import { diffWithoutRenames } from './diffWithoutRenames';

const lastName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * A copy of `graph` in which the block at `from`, and everything below it when it is a
 * hierarchy, has the path `to` (the same parent level, another name). Instance and level
 * keys, paths, names and child lists, net endpoints and the levels and ids of the nets of
 * a renamed level, and address segments follow; nothing else changes.
 */
export function renameInstance(graph: SystemGraph, from: string, to: string): SystemGraph {
  const affected = (path: string): boolean => path === from || path.startsWith(`${from}/`);
  const mapPath = (path: string): string => (affected(path) ? to + path.slice(from.length) : path);
  // The text of an address space or segment starts with the spelling of its owning instance
  // (the path without the leading slash) and a separator: `/` in a Vivado design (`a/b/S_AXI/Reg`),
  // `.` in a Platform Designer one (`cpu.data_master`), with a subsystem prefix `sub/` when grafted.
  // Only the text of an owner that is renamed or below it changes, and only that leading part.
  const mapText = (text: string, owner: string): string => {
    const spelled = owner.slice(1);
    // A Vivado Tcl script may write the text with a leading slash, which stays.
    const lead = text.startsWith('/') ? 1 : 0;
    const separator = text.charAt(lead + spelled.length);
    return affected(owner) &&
      text.startsWith(spelled, lead) &&
      (separator === '/' || separator === '.')
      ? text.slice(0, lead) + mapPath(owner).slice(1) + text.slice(lead + spelled.length)
      : text;
  };
  const mapName = (path: string, name: string): string => (path === from ? lastName(to) : name);

  const instances = Object.fromEntries(
    Object.entries(graph.instances).map(([key, i]): [string, SystemInstance] => [
      mapPath(key),
      affected(key)
        ? { ...i, path: mapPath(i.path), name: mapName(key, i.name), parent: mapPath(i.parent) }
        : i,
    ])
  );
  const levels = Object.fromEntries(
    Object.entries(graph.levels).map(([key, l]): [string, SystemLevel] => [
      mapPath(key),
      {
        ...l,
        path: mapPath(l.path),
        name: mapName(key, l.name),
        instances: l.instances.map(mapPath),
      },
    ])
  );
  const nets = graph.nets.map((n): SystemNet => {
    const endpoints = n.endpoints.map((e) =>
      e.instance === null ? e : { ...e, instance: mapPath(e.instance) }
    );
    return affected(n.level)
      ? { ...n, level: mapPath(n.level), id: `${mapPath(n.level)}::${n.name}`, endpoints }
      : { ...n, endpoints };
  });
  const addressSegments = graph.addressSegments.map(
    (s): AddressSegment => ({
      ...s,
      addressSpace: mapText(s.addressSpace, s.masterInstance),
      segment: mapText(s.segment, s.slaveInstance),
      masterInstance: mapPath(s.masterInstance),
      slaveInstance: mapPath(s.slaveInstance),
    })
  );
  return { ...graph, instances, levels, nets, addressSegments };
}

/** What a block must have in common with its renamed self: where, what and how it is set up. */
function signature(instance: SystemInstance): string {
  const parameters = Object.entries(instance.parameters).sort(([a], [b]) => compareText(a, b));
  const pins = [...new Set(instance.pins.map((p) => p.name))].sort(compareText);
  return JSON.stringify([instance.parent, instance.kind, instanceType(instance), parameters, pins]);
}

/** Pairs of (removed path, added path): the only removed and the only added block of a signature. */
function candidatePairs(
  base: SystemGraph,
  current: SystemGraph,
  plain: SystemGraphDiff
): [string, string][] {
  const groups = new Map<string, { removed: string[]; added: string[] }>();
  for (const change of plain.instances) {
    const removed = change.status === 'removed';
    // Only the topmost block of a renamed subtree: its level exists on both sides.
    if (
      (removed || change.status === 'added') &&
      base.levels[change.level] &&
      current.levels[change.level]
    ) {
      const instance = (removed ? base : current).instances[change.path];
      const group = groups.get(signature(instance)) ?? { removed: [], added: [] };
      group[removed ? 'removed' : 'added'].push(change.path);
      groups.set(signature(instance), group);
    }
  }
  return [...groups.values()]
    .filter((g) => g.removed.length === 1 && g.added.length === 1)
    .map((g): [string, string] => [g.removed[0], g.added[0]])
    .sort(([, a], [, b]) => compareText(a, b));
}

/**
 * Finds the renamed blocks of `plain`, the diff of `base` and `current` without them. A pair
 * is a removed and an added block of one parent level with the same kind, type (version
 * included), parameters and pin names, the only such pair of that signature. All pairs are
 * applied to the base at once and the diff is taken once; a pair is dropped when something at
 * or below its added block differs, and the rest starts again from the original base, until no
 * pair is dropped. So the result depends on no order of the candidates. Returns one `renamed`
 * change per rename and the diff of the base with them applied (`plain` without renames).
 */
export function findRenames(
  base: SystemGraph,
  current: SystemGraph,
  plain: SystemGraphDiff
): { renames: InstanceChange[]; diff: SystemGraphDiff } {
  let pairs = candidatePairs(base, current, plain);
  while (pairs.length > 0) {
    const renamedBase = pairs.reduce((g, [from, to]) => renameInstance(g, from, to), base);
    const diff = diffWithoutRenames(renamedBase, current, new Map(pairs.map(([f, t]) => [t, f])));
    const kept = pairs.filter(
      ([, to]) => !diff.instances.some((i) => i.path === to || i.path.startsWith(`${to}/`))
    );
    if (kept.length === pairs.length) {
      const renames = pairs.map(([from, to]): InstanceChange => {
        const type = instanceType(current.instances[to]);
        return {
          path: to,
          basePath: from,
          level: current.instances[to].parent,
          status: 'renamed',
          baseType: type,
          currentType: type,
          parameters: [],
          pins: [],
        };
      });
      return { renames, diff };
    }
    pairs = kept;
  }
  return { renames: [], diff: plain };
}
