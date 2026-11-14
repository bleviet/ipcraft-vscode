import type { SystemGraphDiffSide } from '../../../domain/systemGraphDiff';

/**
 * The sentence for a base that did not exist at `label` or was read under another path, or
 * undefined for any other base. `quote` wraps the old path (a code span in the Markdown report).
 */
export function baseNote(
  base: SystemGraphDiffSide,
  label: string,
  quote: (text: string) => string = (text) => text
): string | undefined {
  if (base.missing) {
    return `The file did not exist at ${label}: everything is added.`;
  }
  return base.path === undefined
    ? undefined
    : `Read at ${label} as ${quote(base.path)} (renamed since).`;
}
