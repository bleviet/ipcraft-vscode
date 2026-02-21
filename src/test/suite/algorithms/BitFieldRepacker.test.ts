import {
  repackFieldsForward,
  repackFieldsBackward,
} from '../../../webview/algorithms/BitFieldRepacker';

describe('BitFieldRepacker', () => {
  describe('repackFieldsForward (LSB-Ascending)', () => {
    it('should move fields toward MSB (Up) starting from index', () => {
      // Input sorted LSB-Ascending
      const fields = [
        { name: 'field1', bits: '[7:0]', bit_offset: 0, bit_width: 8 },
        { name: 'field2', bits: '[7:0]', bit_offset: 0, bit_width: 8 }, // Overlap
        { name: 'field3', bits: '[7:0]', bit_offset: 0, bit_width: 8 },
      ];

      // Repack 1..2 forward (should prevent overlap with 0)
      const result = repackFieldsForward(fields, 1, 32);

      // Field 1 (Index 0) [7:0] unchanged.
      // Field 2 (Index 1) should be [15:8].
      // Field 3 (Index 2) should be [23:16].
      expect(result[0].bits).toBe('[7:0]');
      expect(result[1].bits).toBe('[15:8]');
      expect(result[2].bits).toBe('[23:16]');
    });

    it('should start from MSB+1 of previous field', () => {
      const fields = [
        { name: 'field1', bits: '[3:0]', bit_offset: 0, bit_width: 4 },
        { name: 'field2', bits: '[3:0]', bit_offset: 0, bit_width: 4 },
      ];

      const result = repackFieldsForward(fields, 1, 32);

      // Field 2 should start at bit 4 (MSB+1 of field 1)
      expect(result[1].bits).toBe('[7:4]');
    });
  });

  describe('repackFieldsBackward (LSB-Ascending)', () => {
    it('should move fields toward LSB (Down) going backward from index', () => {
      // Input sorted LSB-Ascending
      const fields = [
        { name: 'field1', bits: '[15:8]', bit_offset: 8, bit_width: 8 },
        { name: 'field2', bits: '[15:8]', bit_offset: 8, bit_width: 8 }, // Overlap
        { name: 'field3', bits: '[23:16]', bit_offset: 16, bit_width: 8 },
      ];

      // Repack 1..0 backward (should prevent overlap with 2)
      // Start at 1. Next is 2 ([23:16]).
      // 1 should be [15:8]. (Matches current).
      // Then 0. Next is 1 ([15:8]).
      // 0 should be [7:0].
      const result = repackFieldsBackward(fields, 1, 32);

      expect(result[2].bits).toBe('[23:16]');
      expect(result[1].bits).toBe('[15:8]');
      expect(result[0].bits).toBe('[7:0]');
    });

    it('should start from LSB-1 of next field', () => {
      const fields = [
        { name: 'field1', bits: '[10:5]', bit_offset: 5, bit_width: 6 },
        { name: 'field2', bits: '[10:9]', bit_offset: 9, bit_width: 2 }, // example
        { name: 'field3', bits: '[20:16]', bit_offset: 16, bit_width: 5 },
      ];

      // Assume we repack index 1 down.
      // Next is index 2 [20:16]. LSB=16.
      // Index 1 should end at 15. Width 2 -> [15:14].
      const result = repackFieldsBackward(fields, 1, 32);

      expect(result[1].bits).toBe('[15:14]');
    });

    it('should return an unchanged copy for out-of-range fromIndex', () => {
      const fields = [
        { name: 'field1', bits: '[3:0]', bit_offset: 0, bit_width: 4 },
        { name: 'field2', bits: '[7:4]', bit_offset: 4, bit_width: 4 },
      ];

      expect(repackFieldsForward(fields, -1, 32)).toEqual(fields);
      expect(repackFieldsForward(fields, 2, 32)).toEqual(fields);
      expect(repackFieldsBackward(fields, -1, 32)).toEqual(fields);
      expect(repackFieldsBackward(fields, 2, 32)).toEqual(fields);
    });
  });
});
