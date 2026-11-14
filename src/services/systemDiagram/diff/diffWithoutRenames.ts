/** The change list between two graphs by plain identity, without looking for renamed blocks. Pure. */

import type { SystemGraph } from '../../../domain/systemGraph';
import type { DiffSummary, SystemGraphDiff } from '../../../domain/systemGraphDiff';
import { createPinContext } from './diffPins';
import { diffInstances } from './diffInstances';
import { diffPorts } from './diffPorts';
import { diffSegments } from './diffSegments';

function summarize(diff: Pick<SystemGraphDiff, 'instances' | 'ports' | 'segments'>): DiffSummary {
  const summary: DiffSummary = {
    added: 0,
    removed: 0,
    changed: 0,
    version: 0,
    renamed: 0,
    moved: 0,
  };
  for (const change of [...diff.instances, ...diff.ports, ...diff.segments]) {
    summary[change.status] += 1;
  }
  return summary;
}

/** The path a block had in the base, for the new path of a block or of anything below a renamed or moved block. */
function baseNameOf(renamed: ReadonlyMap<string, string>): (path: string) => string {
  return (path) => {
    for (const [to, from] of renamed) {
      if (path === to || path.startsWith(`${to}/`)) {
        return from + path.slice(to.length);
      }
    }
    return path;
  };
}

/**
 * Compares two graphs by identity (instance path, pin owner and name, port name, address
 * segment, parameter key): a renamed block is one removed and one added block.
 * `renamed` (new path to old path of renamed and moved blocks, in `base` already under the new path) only
 * changes how the base side of a pin change names them: with their old paths.
 */
export function diffWithoutRenames(
  base: SystemGraph,
  current: SystemGraph,
  renamed?: ReadonlyMap<string, string>
): SystemGraphDiff {
  const ctx = createPinContext(base, current, renamed && baseNameOf(renamed));
  const changes = {
    instances: diffInstances(base, current, ctx),
    ports: diffPorts(base, current, ctx),
    segments: diffSegments(base, current),
  };
  return {
    base: { name: base.name, format: base.source.format },
    current: { name: current.name, format: current.source.format },
    formatsDiffer: base.source.format !== current.source.format,
    ...changes,
    summary: summarize(changes),
  };
}
