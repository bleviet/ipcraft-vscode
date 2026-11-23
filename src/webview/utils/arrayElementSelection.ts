/**
 * The selection object for one element of a register array: a copy of the array carrying the
 * element's index and base address, plus the original array. The copy is not in the memory map,
 * so `source` is what lets the editor find the array's `$version` diagnostics (matched by identity).
 */
export type ArrayElementSelectionObject<T extends object = Record<string, unknown>> = T & {
  __element_index: number;
  __element_base: number;
  __element_source: T;
};

export function toArrayElementSelectionObject<T extends object>(
  array: T,
  elementIndex: number,
  elementBase: number
): ArrayElementSelectionObject<T> {
  return {
    ...array,
    __element_index: elementIndex,
    __element_base: elementBase,
    __element_source: array,
  };
}
