/** The change list between two revisions of a system design graph. Pure: no `vscode`, DOM or file system. */

import type { SystemGraph } from '../../../domain/systemGraph';
import type { SystemGraphDiff } from '../../../domain/systemGraphDiff';
import { compareText } from './compareText';
import { diffWithoutRenames } from './diffWithoutRenames';
import { findMoves } from './moves';
import { findRenames } from './renames';

/**
 * Compares two graphs by identity (instance path, pin owner and name, port name, address
 * segment, parameter key), then pairs a removed and an added block that are the same block
 * under a new name (see `findRenames`), then one that is the same block under another parent
 * level (see `findMoves`). The result depends only on graph content: not on the order of
 * instances, nets, endpoints or pins, nor on net names or line numbers.
 */
export function diffSystemGraphs(base: SystemGraph, current: SystemGraph): SystemGraphDiff {
  const found = findRenames(base, current, diffWithoutRenames(base, current));
  const renamed = new Map(found.renames.map((r): [string, string] => [r.path, r.basePath ?? '']));
  const { moves, diff } = findMoves(found.base, current, found.diff, renamed);
  if (found.renames.length === 0 && moves.length === 0) {
    return diff;
  }
  return {
    ...diff,
    instances: [...diff.instances, ...found.renames, ...moves].sort((x, y) =>
      compareText(x.path, y.path)
    ),
    summary: { ...diff.summary, renamed: found.renames.length, moved: moves.length },
  };
}
