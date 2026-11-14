import type { DiffSummary, SystemGraphDiff } from '../../../domain/systemGraphDiff';

/** The number of changes a summary counts: added, removed, changed, renamed, moved and version-only. */
export function changeCount(summary: DiffSummary): number {
  return (
    summary.added +
    summary.removed +
    summary.changed +
    summary.renamed +
    summary.moved +
    summary.version
  );
}

/** The diff without the instances whose only change is the version of their type. */
export function withoutVersionOnly(diff: SystemGraphDiff): SystemGraphDiff {
  return {
    ...diff,
    instances: diff.instances.filter((i) => i.status !== 'version'),
    summary: { ...diff.summary, version: 0 },
  };
}
