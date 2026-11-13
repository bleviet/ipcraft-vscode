/** The change list between two revisions of a system design graph. Pure: no `vscode`, DOM or file system. */

import type { SystemGraph } from '../../../domain/systemGraph';
import type { SystemGraphDiff } from '../../../domain/systemGraphDiff';
import { compareText } from './compareText';
import { diffWithoutRenames } from './diffWithoutRenames';
import { findRenames } from './renames';

/**
 * Compares two graphs by identity (instance path, pin owner and name, port name, address
 * segment, parameter key), then pairs a removed and an added block that are the same block
 * under a new name (see `findRenames`). The result depends only on graph content: not on the
 * order of instances, nets, endpoints or pins, nor on net names or line numbers.
 */
export function diffSystemGraphs(base: SystemGraph, current: SystemGraph): SystemGraphDiff {
  const { renames, diff } = findRenames(base, current, diffWithoutRenames(base, current));
  if (renames.length === 0) {
    return diff;
  }
  return {
    ...diff,
    instances: [...diff.instances, ...renames].sort((x, y) => compareText(x.path, y.path)),
    summary: { ...diff.summary, renamed: renames.length },
  };
}
