import type { SystemGraph } from '../../../../../domain/systemGraph';
import type { InstanceChange, SystemGraphDiff } from '../../../../../domain/systemGraphDiff';
import { compareText } from '../../../../../services/systemDiagram/diff/compareText';
import { diffSystemGraphs } from '../../../../../services/systemDiagram/diff/diffSystemGraphs';
import { instanceType } from '../../../../../services/systemDiagram/diff/diffInstances';
import { diffWithoutRenames } from '../../../../../services/systemDiagram/diff/diffWithoutRenames';
import { renameOneByOne } from './renameReference';

const lastName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * Checks `detected`, the diff of `base` and `current` with rename and move detection, against a
 * plain reference. The accepted pairs are the `renamed` and `moved` entries of `detected`:
 * - the detected diff equals the plain diff of the base with exactly those pairs applied one at a
 *   time (an oracle that shares no code with `relocateInstances`), plus the pair entries in path
 *   order; a `moved` entry carries the pins of the moved block in that reference, whose own
 *   entry is not listed again;
 * - in that reference nothing differs at or below a renamed block, nor strictly below a moved
 *   one, and a moved block has no change but its pins;
 * - every moved pair is a real candidate, read from the graphs: the same name, kind, type string,
 *   parameters and pin names in another parent level, and no other removed or added block that is
 *   not below a removed or added one has the same signature;
 * - the graphs stay unchanged (JSON snapshot).
 */
export function expectMatchesMovedBase(
  base: SystemGraph,
  current: SystemGraph,
  detected: SystemGraphDiff
): void {
  const pairsOf = (status: 'renamed' | 'moved') =>
    detected.instances
      .filter((i) => i.status === status)
      .map((i): [string, string] => [i.basePath as string, i.path]);
  const [renames, moves] = [pairsOf('renamed'), pairsOf('moved')];
  const snapshot = JSON.stringify([base, current]);

  const signature = (g: SystemGraph, path: string): string => {
    const i = g.instances[path];
    return JSON.stringify([
      lastName(path),
      i.kind,
      instanceType(i),
      Object.entries(i.parameters).sort(([a], [b]) => compareText(a, b)),
      [...new Set(i.pins.map((p) => p.name))].sort(compareText),
    ]);
  };
  for (const [from, to] of moves) {
    const [b, c] = [base.instances[from], current.instances[to]];
    expect(b).toBeDefined();
    expect(c).toBeDefined();
    expect(current.instances[from]).toBeUndefined();
    expect(base.instances[to]).toBeUndefined();
    expect(b.parent).not.toBe(c.parent);
    expect(signature(base, from)).toBe(signature(current, to));
    // Neither lies below a removed or an added block, and nobody else has its signature.
    const removedOnly = Object.keys(base.instances).filter((p) => !current.instances[p]);
    const addedOnly = Object.keys(current.instances).filter((p) => !base.instances[p]);
    expect(removedOnly).not.toContain(b.parent);
    expect(addedOnly).not.toContain(c.parent);
    const sameSignature = (g: SystemGraph, paths: string[], parents: string[]) =>
      paths.filter(
        (p) => !parents.includes(g.instances[p].parent) && signature(g, p) === signature(base, from)
      );
    expect(sameSignature(base, removedOnly, removedOnly)).toEqual([from]);
    expect(sameSignature(current, addedOnly, addedOnly)).toEqual([to]);
  }

  // Renames first, then moves, as the detection does.
  const relocated = renameOneByOne(base, [...renames, ...moves]);
  const names = new Map([...renames, ...moves].map(([from, to]): [string, string] => [to, from]));
  const plain = diffWithoutRenames(relocated, current, names);
  for (const [, to] of renames) {
    expect(plain.instances.filter((i) => i.path === to || i.path.startsWith(`${to}/`))).toEqual([]);
  }
  const own = new Map(plain.instances.map((i) => [i.path, i]));
  const pairEntries: InstanceChange[] = [];
  for (const [from, to] of [...renames, ...moves]) {
    const [b, c] = [base.instances[from], current.instances[to]];
    const moved = moves.some(([, t]) => t === to);
    const pins = moved ? (own.get(to)?.pins ?? []) : [];
    if (moved) {
      expect(plain.instances.filter((i) => i.path.startsWith(`${to}/`))).toEqual([]);
      const change = own.get(to);
      if (change) {
        expect(change.status).toBe('changed');
        expect(change.parameters).toEqual([]);
        expect(change.baseType).toBe(change.currentType);
        expect(change.pins.every((p) => (p.attributes?.length ?? 0) === 0)).toBe(true);
      }
    }
    pairEntries.push({
      path: to,
      basePath: from,
      level: c.parent,
      status: moved ? 'moved' : 'renamed',
      baseType: instanceType(b),
      currentType: instanceType(c),
      parameters: [],
      pins,
    });
  }
  const movedTo = new Set(moves.map(([, to]) => to));
  const ownChanged = [...movedTo].filter((to) => own.has(to)).length;
  expect(detected).toEqual({
    ...plain,
    instances: [...plain.instances.filter((i) => !movedTo.has(i.path)), ...pairEntries].sort(
      (x, y) => compareText(x.path, y.path)
    ),
    summary: {
      ...plain.summary,
      changed: plain.summary.changed - ownChanged,
      renamed: renames.length,
      moved: moves.length,
    },
  });
  expect(JSON.stringify([base, current])).toBe(snapshot);
}

/** Takes the diff with detection, checks it against the reference and that the graphs stay unchanged. */
export function moveDiffAndCheck(base: SystemGraph, current: SystemGraph): SystemGraphDiff {
  const detected = diffSystemGraphs(base, current);
  expectMatchesMovedBase(base, current, detected);
  return detected;
}
