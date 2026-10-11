import { merge } from 'node-diff3';

export interface ThreeWayMergeResult {
  clean: boolean;
  /** Merged text; only meaningful when `clean`. */
  content: string;
}

/** Splits into lines that keep their terminators, so joining restores the text exactly. */
function splitLines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/**
 * Line-based diff3 merge. `base` is the common ancestor (last generated content),
 * `current` the on-disk file and `incoming` the newly generated content.
 * Identical changes on both sides are not conflicts.
 */
export function mergeThreeWay(
  base: string,
  current: string,
  incoming: string
): ThreeWayMergeResult {
  const result = merge(splitLines(current), splitLines(base), splitLines(incoming), {
    excludeFalseConflicts: true,
  });
  return { clean: !result.conflict, content: result.result.join('') };
}
