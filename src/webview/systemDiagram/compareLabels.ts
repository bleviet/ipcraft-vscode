/** The short texts of the two sides in the Changes tab's bar; the full labels go in the titles. */

/** The longest label shown, in characters. */
export const LABEL_MAX = 32;

const segmentsOf = (label: string): string[] => label.split(/[\\/]/);

/**
 * The texts of the two sides. The current side is always a file; the base is one when it was
 * picked as a file (`baseIsFile`), else it is a revision or commit label and is shown as it is.
 * A file is shown by its name, or, when both are files of the same name, by the shortest
 * trailing path that tells them apart.
 */
export function shortLabels(
  baseLabel: string,
  currentLabel: string,
  baseIsFile: boolean
): [string, string] {
  const current = segmentsOf(currentLabel);
  if (!baseIsFile) {
    return [baseLabel, current.at(-1) as string];
  }
  const base = segmentsOf(baseLabel);
  const longest = Math.max(base.length, current.length);
  for (let count = 1; count <= longest; count++) {
    const shortBase = base.slice(-count).join('/');
    const shortCurrent = current.slice(-count).join('/');
    if (shortBase !== shortCurrent) {
      return [shortBase, shortCurrent];
    }
  }
  return [base.at(-1) as string, current.at(-1) as string];
}

/**
 * `text` cut to at most `max` characters (code points) by replacing the middle with `…`, so
 * the head and the tail stay readable; the tail is at least as long as the head.
 */
export function middleTruncate(text: string, max = LABEL_MAX): string {
  const chars = [...text];
  if (chars.length <= max) {
    return text;
  }
  const tail = Math.ceil((max - 1) / 2);
  const head = max - 1 - tail;
  return `${chars.slice(0, head).join('')}…${chars.slice(chars.length - tail).join('')}`;
}
