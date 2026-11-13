import type { SystemGraphDiff } from '../../../domain/systemGraphDiff';

/** The diff without the instances whose only change is the version of their type. */
export function withoutVersionOnly(diff: SystemGraphDiff): SystemGraphDiff {
  return {
    ...diff,
    instances: diff.instances.filter((i) => i.status !== 'version'),
    summary: { ...diff.summary, version: 0 },
  };
}
