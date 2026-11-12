/** The change list between two revisions of a system design graph. Pure: no `vscode`, DOM or file system. */

import type { SystemGraph } from '../../../domain/systemGraph';
import type { DiffSummary, SystemGraphDiff } from '../../../domain/systemGraphDiff';
import { createPinContext } from './diffPins';
import { diffInstances } from './diffInstances';
import { diffPorts } from './diffPorts';
import { diffSegments } from './diffSegments';

function summarize(diff: Pick<SystemGraphDiff, 'instances' | 'ports' | 'segments'>): DiffSummary {
  const summary: DiffSummary = { added: 0, removed: 0, changed: 0, version: 0 };
  for (const change of [...diff.instances, ...diff.ports, ...diff.segments]) {
    summary[change.status] += 1;
  }
  return summary;
}

/**
 * Compares two graphs by identity (instance path, pin owner and name, port name, address
 * segment, parameter key). The result depends only on graph content: not on the order of
 * instances, nets, endpoints or pins, nor on net names or line numbers.
 */
export function diffSystemGraphs(base: SystemGraph, current: SystemGraph): SystemGraphDiff {
  const ctx = createPinContext(base, current);
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
