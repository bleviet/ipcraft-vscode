import type {
  AddressSegment,
  SystemGraph,
  SystemInstance,
  SystemLevel,
  SystemNet,
} from '../../../../../domain/systemGraph';
import type { InstanceChange, SystemGraphDiff } from '../../../../../domain/systemGraphDiff';
import { compareText } from '../../../../../services/systemDiagram/diff/compareText';
import { diffSystemGraphs } from '../../../../../services/systemDiagram/diff/diffSystemGraphs';
import { instanceType } from '../../../../../services/systemDiagram/diff/diffInstances';
import { diffWithoutRenames } from '../../../../../services/systemDiagram/diff/diffWithoutRenames';

const lastName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const parentOf = (path: string): string => path.slice(0, path.lastIndexOf('/')) || '/';

/**
 * The original rename of one block, kept here as an oracle that shares no code with the one-pass
 * `relocateInstances` of the detection. `to` may also be under another parent level (a move): the
 * block then changes its parent and the child lists of both levels; nets stay on their levels.
 */
function renameOne(graph: SystemGraph, from: string, to: string): SystemGraph {
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
        ? {
            ...i,
            path: mapPath(i.path),
            name: mapName(key, i.name),
            parent: key === from ? parentOf(to) : mapPath(i.parent),
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
          ...l.instances.filter((p) => p !== from || parentOf(from) === parentOf(to)).map(mapPath),
          ...(mapPath(key) === parentOf(to) && parentOf(from) !== parentOf(to) ? [to] : []),
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

/** The renames and moves applied one after the other with the oracle. */
export function renameOneByOne(graph: SystemGraph, pairs: [string, string][]): SystemGraph {
  return pairs.reduce((g, [from, to]) => renameOne(g, from, to), graph);
}

/**
 * Checks `detected`, the diff of `base` and `current` with rename detection, against a plain
 * reference. The accepted pairs are the `renamed` entries of `detected`:
 * - the detected diff equals the plain diff of the base with exactly those renames applied (its
 *   base-side labels written with the old names), plus the `renamed` entries in path order;
 * - nothing differs at or below the added path of any pair in that reference;
 * - every pair is a real candidate, read from the graphs: same parent level, kind, type string,
 *   parameters and pin names; the old path is gone from the current graph and the new one is not
 *   in the base;
 * - every `renamed` entry is exactly what the graphs give: both paths, the level, the type on
 *   both sides, and no parameter or pin change;
 * - the reference diff and the renames it applies leave both graphs unchanged (JSON snapshot).
 */
export function expectMatchesRenamedBase(
  base: SystemGraph,
  current: SystemGraph,
  detected: SystemGraphDiff
): void {
  const renames = detected.instances.filter((i) => i.status === 'renamed');
  const pairs = renames.map((r): [string, string] => [r.basePath as string, r.path]);
  // The entries as the graphs give them, not as `detected` states them.
  const expectedRenames: InstanceChange[] = [];
  for (const [from, to] of pairs) {
    const [b, c] = [base.instances[from], current.instances[to]];
    expect(b).toBeDefined();
    expect(c).toBeDefined();
    expect(current.instances[from]).toBeUndefined();
    expect(base.instances[to]).toBeUndefined();
    expectedRenames.push({
      path: to,
      basePath: from,
      level: c.parent,
      status: 'renamed',
      baseType: instanceType(b),
      currentType: instanceType(c),
      parameters: [],
      pins: [],
    });
    expect([b.parent, b.kind, instanceType(b), b.parameters]).toEqual([
      c.parent,
      c.kind,
      instanceType(c),
      c.parameters,
    ]);
    const names = (pins: { name: string }[]) => new Set(pins.map((p) => p.name));
    expect(names(b.pins)).toEqual(names(c.pins));
  }
  const snapshot = JSON.stringify([base, current]);
  // One rename at a time, with an oracle independent of the one-pass `renameInstances`.
  const renamedBase = renameOneByOne(base, pairs);
  const plain = diffWithoutRenames(
    renamedBase,
    current,
    new Map(pairs.map(([from, to]): [string, string] => [to, from]))
  );
  for (const [, to] of pairs) {
    expect(plain.instances.filter((i) => i.path === to || i.path.startsWith(`${to}/`))).toEqual([]);
  }
  expect(detected).toEqual({
    ...plain,
    instances: [...plain.instances, ...expectedRenames].sort((x, y) => compareText(x.path, y.path)),
    summary: { ...plain.summary, renamed: expectedRenames.length },
  });
  expect(JSON.stringify([base, current])).toBe(snapshot);
}

/** Takes the diff with rename detection, checks it against the reference and that the graphs stay unchanged. */
export function diffAndCheck(base: SystemGraph, current: SystemGraph): SystemGraphDiff {
  const snapshot = JSON.stringify([base, current]);
  const detected = diffSystemGraphs(base, current);
  expect(JSON.stringify([base, current])).toBe(snapshot);
  expectMatchesRenamedBase(base, current, detected);
  return detected;
}
