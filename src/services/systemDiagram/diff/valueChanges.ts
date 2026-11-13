import type { ValueChange } from '../../../domain/systemGraphDiff';
import { compareText } from './compareText';

/** One change per key whose value differs or that exists on one side only, sorted by key. */
export function diffValues(
  base: Record<string, string | undefined>,
  current: Record<string, string | undefined>
): ValueChange[] {
  const keys = new Set([...Object.keys(base), ...Object.keys(current)]);
  const changes: ValueChange[] = [];
  for (const key of [...keys].sort(compareText)) {
    if (base[key] !== current[key]) {
      changes.push({
        key,
        ...(base[key] !== undefined && { base: base[key] }),
        ...(current[key] !== undefined && { current: current[key] }),
      });
    }
  }
  return changes;
}
