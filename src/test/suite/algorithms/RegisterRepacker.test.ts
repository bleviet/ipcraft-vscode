import {
  repackRegistersForward,
  repackRegistersBackward,
} from '../../../webview/algorithms/RegisterRepacker';

describe('RegisterRepacker', () => {
  describe('repackRegistersForward', () => {
    it('should repack registers forward with 4-byte stride', () => {
      const registers = [
        { name: 'REG1', offset: 0x00 },
        { name: 'REG2', offset: 0x10 },
        { name: 'REG3', offset: 0x20 },
      ];

      const result = repackRegistersForward(registers, 1);

      // REG1 unchanged, REG2 and REG3 repacked with 4-byte stride
      expect(result[0].offset).toBe(0x00);
      expect(result[1].offset).toBe(0x04);
      expect(result[2].offset).toBe(0x08);
    });

    it('should handle repacking from index 0', () => {
      const registers = [
        { name: 'REG1', offset: 0x10 },
        { name: 'REG2', offset: 0x20 },
      ];

      const result = repackRegistersForward(registers, 0);

      // All registers repacked from offset 0
      expect(result[0].offset).toBe(0);
      expect(result[1].offset).toBe(4);
    });

    it('should maintain 4-byte alignment', () => {
      const registers = [
        { name: 'REG1', offset: 0x00 },
        { name: 'REG2', offset: 0x20 },
        { name: 'REG3', offset: 0x40 },
      ];

      const result = repackRegistersForward(registers, 1);

      expect(result[0].offset).toBe(0x00);
      expect(result[1].offset).toBe(0x04);
      expect(result[2].offset).toBe(0x08);
    });

    it('should preserve original array', () => {
      const registers = [
        { name: 'REG1', offset: 0x00 },
        { name: 'REG2', offset: 0x10 },
      ];

      const result = repackRegistersForward(registers, 1);

      expect(registers[1].offset).toBe(0x10);
      expect(result[1].offset).toBe(0x04);
    });

    it('should handle empty array', () => {
      const result = repackRegistersForward([], 0);
      expect(result).toEqual([]);
    });

    it('should handle single register', () => {
      const registers = [{ name: 'REG1', offset: 0x10 }];

      const result = repackRegistersForward(registers, 0);

      expect(result[0].offset).toBe(0);
    });

    it('should handle registers with additional properties', () => {
      const registers = [
        { name: 'REG1', offset: 0x00, access: 'read-write', description: 'Control register' },
        { name: 'REG2', offset: 0x10, access: 'read-only', description: 'Status register' },
      ];

      const result = repackRegistersForward(registers, 1);

      // Additional properties should be preserved
      expect(result[1].access).toBe('read-only');
      expect(result[1].description).toBe('Status register');
      expect(result[1].offset).toBe(0x04);
    });
  });

  describe('repackRegistersBackward', () => {
    it('should repack registers backward with 4-byte stride', () => {
      const registers = [
        { name: 'REG1', offset: 0x00 },
        { name: 'REG2', offset: 0x10 },
        { name: 'REG3', offset: 0x20 },
      ];

      const result = repackRegistersBackward(registers, 1);

      // REG3 unchanged, REG1 and REG2 repacked backward
      expect(result[2].offset).toBe(0x20);
      expect(result[1].offset).toBe(0x1c); // 0x20 - 4
      expect(result[0].offset).toBe(0x18); // 0x1C - 4
    });

    it('should handle repacking to end when fromIndex is last', () => {
      const registers = [
        { name: 'REG1', offset: 0x00 },
        { name: 'REG2', offset: 0x10 },
      ];

      const result = repackRegistersBackward(registers, 1);

      // Last register stays, first moves backward
      expect(result[1].offset).toBe(0x10);
      expect(result[0].offset).toBeLessThanOrEqual(0x10);
    });

    it('should clamp to offset 0', () => {
      const registers = [
        { name: 'REG1', offset: 0x00 },
        { name: 'REG2', offset: 0x00 },
        { name: 'REG3', offset: 0x04 },
      ];

      const result = repackRegistersBackward(registers, 1);

      // Should clamp to offset 0
      expect(result[0].offset).toBe(0);
      expect(result[1].offset).toBe(0);
    });

    it('should maintain 4-byte alignment', () => {
      const registers = [
        { name: 'REG1', offset: 0x00 },
        { name: 'REG2', offset: 0x10 },
        { name: 'REG3', offset: 0x20 },
      ];

      const result = repackRegistersBackward(registers, 1);

      expect(result[2].offset).toBe(0x20);
      expect(result[1].offset).toBe(0x1c); // 4-byte aligned
      expect(result[0].offset).toBe(0x18); // 4-byte aligned
    });

    it('should preserve original array', () => {
      const registers = [
        { name: 'REG1', offset: 0x00 },
        { name: 'REG2', offset: 0x10 },
      ];

      const result = repackRegistersBackward(registers, 0);

      expect(registers[0].offset).toBe(0x00);
      expect(result).not.toBe(registers);
    });

    it('should handle empty array', () => {
      const result = repackRegistersBackward([], 0);
      expect(result).toEqual([]);
    });

    it('should handle single register', () => {
      const registers = [{ name: 'REG1', offset: 0x10 }];

      const result = repackRegistersBackward(registers, 0);

      expect(result[0].offset).toBe(0x10);
    });
  });

  describe('Edge cases', () => {
    it('should handle registers at same offset', () => {
      const registers = [
        { name: 'REG1', offset: 0x10 },
        { name: 'REG2', offset: 0x10 },
        { name: 'REG3', offset: 0x10 },
      ];

      const result = repackRegistersForward(registers, 0);

      expect(result[0].offset).toBe(0);
      expect(result[1].offset).toBe(4);
      expect(result[2].offset).toBe(8);
    });

    it('should handle negative offsets (clamped to 0)', () => {
      const registers = [
        { name: 'REG1', offset: 0x00 },
        { name: 'REG2', offset: 0x02 },
      ];

      const result = repackRegistersBackward(registers, 0);

      expect(result[0].offset).toBe(0);
    });

    it('should handle large offset gaps', () => {
      const registers = [
        { name: 'REG1', offset: 0x0000 },
        { name: 'REG2', offset: 0x1000 },
        { name: 'REG3', offset: 0x5000 },
      ];

      const result = repackRegistersForward(registers, 1);

      // Should pack sequentially regardless of original gaps
      expect(result[1].offset).toBe(0x04);
      expect(result[2].offset).toBe(0x08);
    });

    it('should handle repacking middle range', () => {
      const registers = [
        { name: 'REG1', offset: 0x00 },
        { name: 'REG2', offset: 0x10 },
        { name: 'REG3', offset: 0x20 },
        { name: 'REG4', offset: 0x30 },
      ];

      const result = repackRegistersForward(registers, 2);

      // REG1 and REG2 unchanged, REG3 and REG4 repacked
      expect(result[0].offset).toBe(0x00);
      expect(result[1].offset).toBe(0x10);
      expect(result[2].offset).toBe(0x14); // After REG2
      expect(result[3].offset).toBe(0x18);
    });
  });
});
