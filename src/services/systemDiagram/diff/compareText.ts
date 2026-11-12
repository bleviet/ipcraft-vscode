/** Code-unit order, so the sorted output never depends on the locale. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
