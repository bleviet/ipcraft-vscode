/**
 * Keeps React Flow elements referentially stable. React Flow skips a node or
 * edge whose object is the one it already holds, so handing back the previous
 * object for an element that draws the same thing avoids rendering it again.
 */

const shallowEqual = (a: object, b: object): boolean => {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    )
  );
};

const sameData = (a: unknown, b: unknown): boolean =>
  a === b ||
  (typeof a === 'object' &&
    typeof b === 'object' &&
    a !== null &&
    b !== null &&
    shallowEqual(a, b));

const sameElement = (a: StableElement, b: StableElement): boolean => {
  const { data: dataA, ...restA } = a;
  const { data: dataB, ...restB } = b;
  return shallowEqual(restA, restB) && sameData(dataA, dataB);
};

interface StableElement {
  id: string;
  data?: unknown;
}

/**
 * For each of `next`, the element of `previous` with the same id when the two
 * are shallow-equal (top level and `data`, compared with `Object.is`), else the
 * new one. A new element whose `data` still equals the previous one keeps the
 * previous `data` object, so a node component memoized on `data` is not
 * rendered again when only the element around it (say, its class) changed.
 * Returns `previous` itself when every element was reused.
 */
export function reuseUnchanged<T extends StableElement>(previous: T[], next: T[]): T[] {
  const before = new Map(previous.map((element) => [element.id, element]));
  const reused = next.map((element) => {
    const old = before.get(element.id);
    if (old === undefined) {
      return element;
    }
    if (sameElement(old, element)) {
      return old;
    }
    return sameData(old.data, element.data) ? { ...element, data: old.data } : element;
  });
  return reused.length === previous.length && reused.every((element, i) => element === previous[i])
    ? previous
    : reused;
}
