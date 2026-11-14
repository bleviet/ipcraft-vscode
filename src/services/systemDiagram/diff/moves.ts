/**
 * Moved blocks. A block is identified by its path, so a move to another level is one removed
 * and one added block. Like a rename (see `findRenames`) the rule is conservative: it pairs only
 * a block that is identical at both places and has the same name, and only when no other
 * candidate could be it. Pure: no `vscode`, no DOM.
 */

import type { SystemGraph } from '../../../domain/systemGraph';
import type { InstanceChange, SystemGraphDiff } from '../../../domain/systemGraphDiff';
import { compareText } from './compareText';
import { instanceType } from './diffInstances';
import { diffWithoutRenames } from './diffWithoutRenames';
import { buildPeerLookup, instancePin, type PinId } from './pinPeers';
import { relocateInstances } from './relocate';
import { signature } from './renames';

const lastName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/**
 * Pairs of (removed path, added path): the only removed and the only added block of a signature
 * (name, kind, type, parameters, pin names), the topmost of their subtrees: neither lies below
 * another removed (added) block.
 */
function candidatePairs(
  base: SystemGraph,
  current: SystemGraph,
  plain: SystemGraphDiff
): [string, string][] {
  const [removedPaths, addedPaths] = [new Set<string>(), new Set<string>()];
  for (const { path, status } of plain.instances) {
    if (status === 'removed' || status === 'added') {
      (status === 'removed' ? removedPaths : addedPaths).add(path);
    }
  }
  const groups = new Map<string, { removed: string[]; added: string[] }>();
  for (const change of plain.instances) {
    const removed = change.status === 'removed';
    if (
      (removed && !removedPaths.has(change.level)) ||
      (change.status === 'added' && !addedPaths.has(change.level))
    ) {
      const instance = (removed ? base : current).instances[change.path];
      const key = signature(instance, lastName(change.path));
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

/** Whether a block's own change in the diff of the moved base is only that its pins were rewired. */
function onlyRewired(change: InstanceChange | undefined): boolean {
  return (
    change === undefined ||
    (change.status === 'changed' &&
      change.baseType === change.currentType &&
      change.parameters.length === 0 &&
      !change.pins.some((p) => (p.attributes?.length ?? 0) > 0))
  );
}

const isUnder = (path: string, root: string): boolean =>
  path === root || path.startsWith(`${root}/`);

/**
 * The moved blocks (their new paths in `pairs`) that are connected, in `movedBase` or in
 * `current`, to a pin of one of the renamed blocks `renamedTo` or of something below it: the
 * moves that can change those renamed blocks.
 */
function movesNextTo(
  renamedTo: string[],
  pairs: [string, string][],
  movedBase: SystemGraph,
  current: SystemGraph
): Set<string> {
  const lookups = [buildPeerLookup(movedBase), buildPeerLookup(current)];
  const culprits = new Set<string>();
  const isMoved = (peer: PinId, to: string): boolean => isUnder(peer.instance ?? peer.level, to);
  for (const graph of [movedBase, current]) {
    for (const instance of Object.values(graph.instances)) {
      if (renamedTo.some((root) => isUnder(instance.path, root))) {
        const ids: PinId[] = instance.pins.flatMap((pin) => [
          instancePin(instance.path, pin.name),
          ...(instance.kind === 'hier'
            ? [{ instance: null, level: instance.path, pin: pin.name }]
            : []),
        ]);
        for (const peer of lookups.flatMap((lookup) => ids.flatMap((id) => lookup(id)))) {
          for (const [, to] of pairs) {
            if (isMoved(peer, to)) {
              culprits.add(to);
            }
          }
        }
      }
    }
  }
  return culprits;
}

/**
 * Finds the moved blocks of `plain`, the diff of `base` and `current` after the renames (`base`
 * has them applied already; `renamed` maps the new path of each renamed block to its old one). A
 * pair is a removed and an added block with the same name, kind, type (version included),
 * parameters and pin names but another parent, the only such pair of that signature, and the
 * topmost of its subtree. All pairs are applied to the base at once and the diff is taken once;
 * a pair is dropped when anything below its added block differs or the block itself has a
 * change other than its pins (a moved block usually has its pins rewired, its nets stay on their
 * levels), and the rest starts again from the original base, until no pair is dropped. So the
 * result depends on no order of the candidates. A renamed block was paired without the moves:
 * when they would change it, the moves connected to it are dropped too (all of them when none
 * can be told). Returns one `moved` change per move, carrying
 * the pin changes of the moved block, the base with the moves applied and its diff (`plain`
 * without the moved blocks' own entries).
 */
export function findMoves(
  base: SystemGraph,
  current: SystemGraph,
  plain: SystemGraphDiff,
  renamed: ReadonlyMap<string, string>
): { moves: InstanceChange[]; base: SystemGraph; diff: SystemGraphDiff } {
  let pairs = candidatePairs(base, current, plain);
  while (pairs.length > 0) {
    const movedBase = relocateInstances(base, new Map(pairs));
    const names = new Map([...renamed, ...pairs.map(([from, to]): [string, string] => [to, from])]);
    const diff = diffWithoutRenames(movedBase, current, names);
    // The paths of the changed blocks, and (`below`) all their proper ancestors.
    const [changed, below] = [new Set<string>(), new Set<string>()];
    for (const { path } of diff.instances) {
      changed.add(path);
      for (
        let end = path.lastIndexOf('/');
        end > 0 && !below.has(path.slice(0, end));
        end = path.lastIndexOf('/', end - 1)
      ) {
        below.add(path.slice(0, end));
      }
    }
    const own = new Map(diff.instances.map((c) => [c.path, c]));
    const kept = pairs.filter(([, to]) => !below.has(to) && onlyRewired(own.get(to)));
    if (kept.length === pairs.length) {
      const changedRenames = [...renamed.keys()].filter((to) => changed.has(to) || below.has(to));
      if (changedRenames.length > 0) {
        const culprits = movesNextTo(changedRenames, pairs, movedBase, current);
        // No culprit is a safety net, believed unreachable: a renamed block can only change
        // through a peer inside a moved subtree, which `movesNextTo` finds.
        pairs = culprits.size > 0 ? pairs.filter(([, to]) => !culprits.has(to)) : [];
        continue;
      }
      const moved = new Set(pairs.map(([, to]) => to));
      const moves = pairs.map(([from, to]): InstanceChange => {
        const type = instanceType(current.instances[to]);
        return {
          path: to,
          basePath: from,
          level: current.instances[to].parent,
          status: 'moved',
          baseType: type,
          currentType: type,
          parameters: [],
          pins: own.get(to)?.pins ?? [],
        };
      });
      const reported = [...moved].filter((to) => own.has(to)).length;
      return {
        moves,
        base: movedBase,
        diff: {
          ...diff,
          instances: diff.instances.filter((c) => !moved.has(c.path)),
          summary: { ...diff.summary, changed: diff.summary.changed - reported },
        },
      };
    }
    pairs = kept;
  }
  return { moves: [], base, diff: plain };
}
