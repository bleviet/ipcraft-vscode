/**
 * Renamed blocks. A block is identified by its path, so a rename is one removed and one added
 * block. The rule is conservative, because a wrong rename hides a real change: it pairs only
 * a block that is identical under both names, and only when no other candidate could be it.
 * Pure: no `vscode`, no DOM.
 */

import type { SystemGraph, SystemInstance } from '../../../domain/systemGraph';
import type { InstanceChange, SystemGraphDiff } from '../../../domain/systemGraphDiff';
import { compareText } from './compareText';
import { instanceType } from './diffInstances';
import { diffWithoutRenames } from './diffWithoutRenames';
import { relocateInstances } from './relocate';

/**
 * What a block must have in common with its renamed or moved self: the `place` it keeps (the
 * parent level for a rename, the name for a move), its kind, type, parameters and pin names.
 */
export function signature(instance: SystemInstance, ...place: string[]): string {
  const parameters = Object.entries(instance.parameters).sort(([a], [b]) => compareText(a, b));
  const pins = [...new Set(instance.pins.map((p) => p.name))].sort(compareText);
  return JSON.stringify([...place, instance.kind, instanceType(instance), parameters, pins]);
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
      const key = signature(instance, instance.parent);
      const group = groups.get(key) ?? { removed: [], added: [] };
      group[removed ? 'removed' : 'added'].push(change.path);
      groups.set(key, group);
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
 * change per rename, the base with them applied (the base itself when there is none) and its
 * diff (`plain` without renames).
 */
export function findRenames(
  base: SystemGraph,
  current: SystemGraph,
  plain: SystemGraphDiff
): { renames: InstanceChange[]; base: SystemGraph; diff: SystemGraphDiff } {
  let pairs = candidatePairs(base, current, plain);
  while (pairs.length > 0) {
    const renamedBase = relocateInstances(base, new Map(pairs));
    const diff = diffWithoutRenames(renamedBase, current, new Map(pairs.map(([f, t]) => [t, f])));
    // The changed blocks and all their ancestors: a pair is dropped when its added block is one.
    const touched = new Set<string>();
    for (const { path } of diff.instances) {
      for (let end = path.length; end > 0 && !touched.has(path.slice(0, end)); ) {
        touched.add(path.slice(0, end));
        end = path.lastIndexOf('/', end - 1);
      }
    }
    const kept = pairs.filter(([, to]) => !touched.has(to));
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
      return { renames, base: renamedBase, diff };
    }
    pairs = kept;
  }
  return { renames: [], base, diff: plain };
}
