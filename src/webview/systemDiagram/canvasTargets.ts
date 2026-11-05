const NON_PANE_AREAS = [
  '.react-flow__node',
  '.react-flow__edge',
  '.react-flow__panel',
  '.react-flow__controls',
  '.nopan',
].join(',');

/**
 * True when a double-click landed on the empty React Flow canvas: inside the
 * pane, but not on a node, edge, panel, control, or net badge (`nopan`).
 * React Flow 12 has no pane double-click callback, so the canvas wrapper
 * listens for the DOM event and asks this.
 */
export function isPaneDoubleClick(target: Element): boolean {
  return target.closest('.react-flow__pane') !== null && target.closest(NON_PANE_AREAS) === null;
}
