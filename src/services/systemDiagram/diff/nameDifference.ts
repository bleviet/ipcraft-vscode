/** Where two names differ: the characters between their common prefix and common suffix. */

/** A piece of a name; `mark`: the part of a name that differs from the other side. */
export interface NamePart {
  text: string;
  mark?: true;
}

/**
 * The parts of `base` and `current`: the common prefix and the common suffix unmarked, the
 * middle of each name marked. An empty piece produces no part (the middle of one name is empty
 * when the other only inserted characters).
 */
export function nameDifference(
  base: string,
  current: string
): { base: NamePart[]; current: NamePart[] } {
  const shortest = Math.min(base.length, current.length);
  let prefix = 0;
  while (prefix < shortest && base[prefix] === current[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < shortest - prefix &&
    base[base.length - 1 - suffix] === current[current.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  const parts = (name: string): NamePart[] =>
    [
      { text: name.slice(0, prefix) },
      { text: name.slice(prefix, name.length - suffix), mark: true as const },
      { text: name.slice(name.length - suffix) },
    ].filter((part) => part.text !== '');
  return { base: parts(base), current: parts(current) };
}
