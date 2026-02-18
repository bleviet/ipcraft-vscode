import {
  parseBitsRange,
  formatBits,
  repackFieldsFrom,
  repackFieldsForward,
  repackFieldsBackward,
} from '../../../webview/algorithms/BitFieldRepacker';

describe('BitFieldRepacker', () => {
  describe('parseBitsRange', () => {
    it('should parse range format [MSB:LSB]', () => {
      expect(parseBitsRange('[31:0]')).toEqual([31, 0]);
      expect(parseBitsRange('[15:8]')).toEqual([15, 8]);
      expect(parseBitsRange('[7:0]')).toEqual([7, 0]);
    });

    it('should parse single bit format [N]', () => {
      expect(parseBitsRange('[5]')).toEqual([5, 5]);
      expect(parseBitsRange('[0]')).toEqual([0, 0]);
      expect(parseBitsRange('[31]')).toEqual([31, 31]);
    });

    it('should return null for invalid formats', () => {
      expect(parseBitsRange('')).toBeNull();
      expect(parseBitsRange('invalid')).toBeNull();
      expect(parseBitsRange('[31-0]')).toBeNull();
      expect(parseBitsRange('31:0')).toBeNull();
    });

    it('should handle reverse order (LSB:MSB)', () => {
      expect(parseBitsRange('[0:7]')).toEqual([0, 7]);
    });
  });

  describe('formatBits', () => {
    it('should format as single bit when MSB equals LSB', () => {
      expect(formatBits(5, 5)).toBe('[5]');
      expect(formatBits(0, 0)).toBe('[0]');
      expect(formatBits(31, 31)).toBe('[31]');
    });

    it('should format as range when MSB differs from LSB', () => {
      expect(formatBits(31, 0)).toBe('[31:0]');
      expect(formatBits(15, 8)).toBe('[15:8]');
      expect(formatBits(7, 0)).toBe('[7:0]');
    });
  });

  describe('repackFieldsFrom (MSB-Descending Legacy)', () => {
    it('should repack fields from start index maintaining widths (MSB-Descending assumption)', () => {
      const fields = [
        { name: 'field1', bits: '[31:24]', bit_offset: 24, bit_width: 8 },
        { name: 'field2', bits: '[15:8]', bit_offset: 8, bit_width: 8 },
        { name: 'field3', bits: '[7:0]', bit_offset: 0, bit_width: 8 },
      ];

      const result = repackFieldsFrom(fields, 32, 1);

      // Field 1 unchanged, field 2 starts at bit 23, field 3 at bit 15
      expect(result[0].bits).toBe('[31:24]');
      expect(result[1].bits).toBe('[23:16]');
      expect(result[2].bits).toBe('[15:8]');
    });
  });

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
  });
});
