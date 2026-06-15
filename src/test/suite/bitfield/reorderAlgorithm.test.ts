import { computeCtrlDragPreview } from '../../../webview/components/bitfield/reorderAlgorithm';
import type { FieldModel } from '../../../webview/components/BitFieldVisualizer';

const makeFields = (): FieldModel[] => [
  { name: 'RUN', bits: '[0:0]', offset: 0, width: 1, bitRange: [0, 0] },
  { name: 'STOP_ON_ERR', bits: '[1:1]', offset: 1, width: 1, bitRange: [1, 1] },
  { name: 'LOG_LEVEL', bits: '[7:4]', offset: 4, width: 4, bitRange: [7, 4] },
  { name: 'CLEAR_STATS', bits: '[31:31]', offset: 31, width: 1, bitRange: [31, 31] },
];

describe('computeCtrlDragPreview', () => {
  it('drag STOP_ON_ERR to bit 0 puts it at [0:0] and shifts RUN to [1:1]', () => {
    const fields = makeFields();
    const result = computeCtrlDragPreview(0, 1, fields, 32);

    expect(result).not.toBeNull();
    const updates = result!.updates;

    const stopOnErr = updates.find((u) => u.idx === 1);
    expect(stopOnErr).toBeDefined();
    expect(stopOnErr!.range).toEqual([0, 0]);

    const run = updates.find((u) => u.idx === 0);
    expect(run).toBeDefined();
    expect(run!.range).toEqual([1, 1]);
  });

  it('produces non-overlapping, register-covering updates after drag', () => {
    const fields = makeFields();
    const result = computeCtrlDragPreview(0, 1, fields, 32);

    const fieldUpdates = result!.updates;
    const fieldSegments = fieldUpdates
      .map((u) => ({ idx: u.idx, lo: u.range[1], hi: u.range[0] }))
      .sort((a, b) => a.lo - b.lo);

    for (let i = 1; i < fieldSegments.length; i++) {
      expect(fieldSegments[i].lo).toBeGreaterThan(fieldSegments[i - 1].hi);
    }
  });
});
