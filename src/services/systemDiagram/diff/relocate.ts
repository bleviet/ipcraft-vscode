/**
 * Applies renames and moves of blocks to a system graph in one pass. Pure: no `vscode`, no DOM.
 */

import type {
  AddressSegment,
  SystemGraph,
  SystemInstance,
  SystemLevel,
  SystemNet,
} from '../../../domain/systemGraph';
import { parentLevel } from './pinPeers';

const lastName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * A copy of `graph` in which every block that is a key of `relocations` (from path -> to path),
 * and everything below it when it is a hierarchy, has its new path: another name under the
 * same parent level (a rename) or another parent level (a move). Instance and level keys,
 * paths, names and child lists, net endpoints and the levels and ids of the nets of a relocated
 * level, and address segments follow; nothing else changes. A moved block's nets stay on the
 * levels they were on, so its pins see the same endpoints under its new path. One pass over the
 * graph, whatever the number of relocations. The keys must not lie below each other (a path is
 * relocated by its nearest relocated ancestor-or-self); `findRenames` and `findMoves` pair only
 * the topmost block of a subtree, so their keys never do.
 */
export function relocateInstances(
  graph: SystemGraph,
  relocations: ReadonlyMap<string, string>
): SystemGraph {
  // The renamed block that `path` is or lies below: the nearest of its prefixes cut at a `/`.
  const renamedRoot = (path: string): string | undefined => {
    for (let end = path.length; end > 0; end = path.lastIndexOf('/', end - 1)) {
      const from = path.slice(0, end);
      if (relocations.has(from)) {
        return from;
      }
    }
    return undefined;
  };
  const affected = (path: string): boolean => renamedRoot(path) !== undefined;
  const mapPath = (path: string): string => {
    const from = renamedRoot(path);
    return from === undefined ? path : (relocations.get(from) as string) + path.slice(from.length);
  };
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
  const mapName = (path: string, name: string): string => {
    const to = relocations.get(path);
    return to === undefined ? name : lastName(to);
  };

  // A relocated block is the child of the level its new path names; what is below it keeps its parent.
  const mapParent = (key: string, parent: string): string => {
    const to = relocations.get(key);
    return to === undefined ? mapPath(parent) : parentLevel(to);
  };
  // The blocks that leave a level, and those that join one: a move changes two child lists.
  // The new parent level may be missing in the base (a leaf that became a hierarchy): the block then joins no child list.
  const leaving = new Set<string>();
  const joining = new Map<string, string[]>();
  for (const [from, to] of relocations) {
    const [oldParent, newParent] = [parentLevel(from), parentLevel(to)];
    if (oldParent !== newParent) {
      leaving.add(from);
      joining.set(newParent, [...(joining.get(newParent) ?? []), to]);
    }
  }

  const instances = Object.fromEntries(
    Object.entries(graph.instances).map(([key, i]): [string, SystemInstance] => [
      mapPath(key),
      affected(key)
        ? {
            ...i,
            path: mapPath(i.path),
            name: mapName(key, i.name),
            parent: mapParent(key, i.parent),
          }
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
        instances: [
          ...l.instances.filter((p) => !leaving.has(p)).map(mapPath),
          ...(joining.get(mapPath(key)) ?? []),
        ],
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
