/**
 * Findings of the system design comparison (issue #302): the unconnected pins and the clock and
 * reset crossings that differ between two revisions. Pure: no `vscode`, no DOM.
 */

import type { SystemGraph } from '../../../domain/systemGraph';
import type {
  CrossingFinding,
  Finding,
  FindingsDiff,
  SystemGraphDiff,
  UnconnectedFinding,
} from '../../../domain/systemGraphDiff';
import { analyzeClocks } from '../../../webview/systemDiagram/clocks/analyzeClocks';
import type { PinCrossing } from '../../../webview/systemDiagram/clocks/clockTypes';
import { endKey } from '../../../webview/systemDiagram/clocks/physicalNets';
import { unconnectedPins } from '../../../webview/systemDiagram/unconnectedPins';
import { compareText } from './compareText';
import { renameInstances } from './renames';

const KIND_ORDER: Record<Finding['kind'], number> = {
  undriven: 0,
  unused: 1,
  dataCrossing: 2,
  resetCrossing: 3,
};

/** A finding with its identity: two revisions have the same finding when the keys are equal. */
interface Keyed {
  key: string;
  finding: Finding;
}

const lastName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

function unconnectedFindings(graph: SystemGraph): Keyed[] {
  return unconnectedPins(graph).map(({ cls, level, nodeId, instance, pin }) => {
    const finding: UnconnectedFinding = {
      kind: cls,
      level,
      instance,
      pin: pin.name,
      label: instance === null ? pin.name : `${lastName(instance)}/${pin.name}`,
    };
    return { key: `${cls}|${level}|${nodeId}|${pin.name}`, finding };
  });
}

/**
 * The key of a crossing is its two ends, never `crossing.id`: the id of a reset whose source is
 * unknown holds the net id, and Vivado renames nets.
 */
function crossingFinding(crossing: PinCrossing): Keyed {
  const { from, to } = crossing;
  const fromKey = from.sourceUnknown ? 'unknown' : endKey(from);
  const finding: CrossingFinding = {
    kind: crossing.kind === 'data' ? 'dataCrossing' : 'resetCrossing',
    level: crossing.level,
    from: from.label,
    to: to.label,
    ...(from.domain && { fromClock: from.domain.label }),
    ...(to.domain && { toClock: to.domain.label }),
    reason: crossing.reason,
  };
  return { key: `${crossing.kind}|${fromKey}>${endKey(to)}`, finding };
}

/** One entry per key; the first one wins. */
function findingsOf(graph: SystemGraph): Map<string, Finding> {
  const found = new Map<string, Finding>();
  const crossings = analyzeClocks(graph).crossings.flatMap((crossing) =>
    crossing.kind !== 'block' && crossing.status === 'cross' ? [crossingFinding(crossing)] : []
  );
  for (const { key, finding } of [...unconnectedFindings(graph), ...crossings]) {
    if (!found.has(key)) {
      found.set(key, finding);
    }
  }
  return found;
}

const what = (finding: Finding): [string, string] =>
  'label' in finding ? [finding.label, ''] : [finding.from, finding.to];

function compareFindings(x: [string, Finding], y: [string, Finding]): number {
  const [a, b] = [x[1], y[1]];
  const [[aFirst, aSecond], [bFirst, bSecond]] = [what(a), what(b)];
  return (
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    compareText(a.level, b.level) ||
    compareText(aFirst, bFirst) ||
    compareText(aSecond, bSecond) ||
    compareText(x[0], y[0])
  );
}

function only(source: Map<string, Finding>, other: Map<string, Finding>): Finding[] {
  return [...source]
    .filter(([key]) => !other.has(key))
    .sort(compareFindings)
    .map(([, finding]) => finding);
}

/**
 * The findings of `current` that `base` does not have (new) and the other way round (resolved).
 * A finding of one graph is an unconnected pin (`unconnectedPins`) or a `data` or `reset` crossing
 * with status `cross` (`analyzeClocks`); block crossings are only listed, and `related`, `inside`,
 * `unchecked` and `ok` crossings are not findings. Each analysis runs once per graph, on the
 * design alone: a pin of a block without a known pin list is not checked.
 *
 * A renamed block (see `diff`) keeps its findings: the base's are computed with the block under
 * its new name, so they are neither new nor resolved, and resolved findings carry the new names.
 */
export function diffFindings(
  base: SystemGraph,
  current: SystemGraph,
  diff: SystemGraphDiff
): FindingsDiff {
  const renames = new Map(
    diff.instances.flatMap((change) =>
      change.status === 'renamed' && change.basePath !== undefined
        ? [[change.basePath, change.path] as const]
        : []
    )
  );
  const before = findingsOf(renames.size > 0 ? renameInstances(base, renames) : base);
  const now = findingsOf(current);
  return { new: only(now, before), resolved: only(before, now) };
}
