import { computeReorderPreview } from '../../../webview/utils/reorderPreview';

describe('computeReorderPreview', () => {
  it('returns identity order when there is no real move', () => {
    expect(computeReorderPreview(4, 1, 1, false)).toEqual([0, 1, 2, 3]);
    expect(computeReorderPreview(4, -1, 2, false)).toEqual([0, 1, 2, 3]);
    expect(computeReorderPreview(0, 0, 0, false)).toEqual([]);
  });

  it('moves an item down, dropping after the target', () => {
    // Drag index 0 onto index 2 (after) -> [1,2,0,3]
    expect(computeReorderPreview(4, 0, 2, true)).toEqual([1, 2, 0, 3]);
  });

  it('moves an item down, dropping before the target', () => {
    // Drag index 0 onto index 2 (before) -> [1,0,2,3]
    expect(computeReorderPreview(4, 0, 2, false)).toEqual([1, 0, 2, 3]);
  });

  it('moves an item up, dropping before the target', () => {
    // Drag index 3 onto index 0 (before) -> [3,0,1,2]
    expect(computeReorderPreview(4, 3, 0, false)).toEqual([3, 0, 1, 2]);
  });

  it('moves an item up, dropping after the target', () => {
    // Drag index 3 onto index 0 (after) -> [0,3,1,2]
    expect(computeReorderPreview(4, 3, 0, true)).toEqual([0, 3, 1, 2]);
  });

  it('is a no-op when the computed destination equals the source', () => {
    // Drag index 1 onto index 1's lower half (after) collapses to itself.
    expect(computeReorderPreview(3, 1, 0, true)).toEqual([0, 1, 2]);
  });

  it('matches a sequence of adjacent swaps (commit parity)', () => {
    // Mirrors the field-move commit: dragging B(1) below C(2) yields A,C,B,D.
    const order = computeReorderPreview(4, 1, 2, true);
    expect(order).toEqual([0, 2, 1, 3]);
  });
});
