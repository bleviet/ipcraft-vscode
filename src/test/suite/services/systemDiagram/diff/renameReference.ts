import type { SystemGraph } from '../../../../../domain/systemGraph';
import type { InstanceChange, SystemGraphDiff } from '../../../../../domain/systemGraphDiff';
import { compareText } from '../../../../../services/systemDiagram/diff/compareText';
import { diffSystemGraphs } from '../../../../../services/systemDiagram/diff/diffSystemGraphs';
import { instanceType } from '../../../../../services/systemDiagram/diff/diffInstances';
import { diffWithoutRenames } from '../../../../../services/systemDiagram/diff/diffWithoutRenames';
import { renameInstance } from '../../../../../services/systemDiagram/diff/renames';

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
  const renamedBase = pairs.reduce((g, [from, to]) => renameInstance(g, from, to), base);
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
