/**
 * Pure helper for drag-to-reorder "live preview" ordering.
 *
 * Given a list length and a drag from `fromIdx` onto `toIdx` (dropping either
 * before or `after` the target), returns the list of real indices in the order
 * they should be rendered while the drag is in progress. The dragged item is
 * moved into its prospective slot; every other item keeps its identity.
 *
 * The destination math mirrors the commit paths in `useFieldEditor` and
 * `useOutlineDragReorder`, so the preview always lands where the drop will.
 */
export function computeReorderPreview(
  length: number,
  fromIdx: number,
  toIdx: number,
  after: boolean
): number[] {
  const order = Array.from({ length }, (_, i) => i);
  if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx || length === 0) {
    return order;
  }
  let dest = toIdx + (after ? 1 : 0);
  if (fromIdx < dest) {
    dest--;
  }
  dest = Math.max(0, Math.min(length - 1, dest));
  if (dest === fromIdx) {
    return order;
  }
  const [moved] = order.splice(fromIdx, 1);
  order.splice(dest, 0, moved);
  return order;
}
