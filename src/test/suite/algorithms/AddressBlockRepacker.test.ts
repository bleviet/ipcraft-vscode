import {
  repackBlocksForward,
  repackBlocksBackward,
} from '../../../webview/algorithms/AddressBlockRepacker';

describe('AddressBlockRepacker', () => {
  describe('repackBlocksForward', () => {
    it('should repack blocks forward maintaining sizes', () => {
      const blocks = [
        { name: 'Block1', base_address: 0x0000, size: 0x1000 },
        { name: 'Block2', base_address: 0x2000, size: 0x1000 },
        { name: 'Block3', base_address: 0x5000, size: 0x2000 },
      ];

      const result = repackBlocksForward(blocks, 1);

      // Block 0 unchanged, blocks 1-2 repacked sequentially
      expect(result[0].base_address).toBe(0x0000);
      expect(result[1].base_address).toBe(0x1000); // After block 0
      expect(result[2].base_address).toBe(0x2000); // After block 1
    });

    it('should handle repacking from index 0', () => {
      const blocks = [
        { name: 'Block1', base_address: 0x1000, size: 0x1000 },
        { name: 'Block2', base_address: 0x5000, size: 0x2000 },
      ];

      const result = repackBlocksForward(blocks, 0);

      // All blocks repacked from address 0
      expect(result[0].base_address).toBe(0);
      expect(result[1].base_address).toBe(0x1000);
    });

    it('should handle blocks with varying sizes', () => {
      const blocks = [
        { name: 'Block1', base_address: 0x0000, size: 0x100 },
        { name: 'Block2', base_address: 0x1000, size: 0x2000 },
        { name: 'Block3', base_address: 0x5000, size: 0x500 },
      ];

      const result = repackBlocksForward(blocks, 1);

      expect(result[0].base_address).toBe(0x0000);
      expect(result[1].base_address).toBe(0x100); // 0x000 + 0x100
      expect(result[2].base_address).toBe(0x2100); // 0x100 + 0x2000
    });

    it('should preserve original array', () => {
      const blocks = [
        { name: 'Block1', base_address: 0x0000, size: 0x1000 },
        { name: 'Block2', base_address: 0x2000, size: 0x1000 },
      ];

      const result = repackBlocksForward(blocks, 1);

      // Original should be unchanged
      expect(blocks[1].base_address).toBe(0x2000);
      expect(result[1].base_address).toBe(0x1000);
    });

    it('should handle single block', () => {
      const blocks = [{ name: 'Block1', base_address: 0x5000, size: 0x1000 }];

      const result = repackBlocksForward(blocks, 0);

      expect(result[0].base_address).toBe(0);
    });

    it('should handle empty array', () => {
      const result = repackBlocksForward([], 0);
      expect(result).toEqual([]);
    });

    it('should handle type coercion for size property', () => {
      const blocks = [
        { name: 'Block1', base_address: 0x0000, size: 0x1000 },
        { name: 'Block2', base_address: 0x2000, size: undefined as any },
      ];

      const result = repackBlocksForward(blocks, 1);

      // Should use 0 for undefined size
      expect(result[1].base_address).toBe(0x1000);
    });
  });

  describe('repackBlocksBackward', () => {
    it('should repack blocks backward maintaining sizes', () => {
      const blocks = [
        { name: 'Block1', base_address: 0x0000, size: 0x1000 },
        { name: 'Block2', base_address: 0x2000, size: 0x1000 },
        { name: 'Block3', base_address: 0x5000, size: 0x2000 },
      ];

      const result = repackBlocksBackward(blocks, 1);

      // Block 2 unchanged, blocks 0-1 repacked backward
      expect(result[2].base_address).toBe(0x5000);
      expect(result[1].base_address).toBe(0x4000); // 0x5000 - 0x1000
      expect(result[0].base_address).toBe(0x3000); // 0x4000 - 0x1000
    });

    it('should handle repacking to end when fromIndex is last', () => {
      const blocks = [
        { name: 'Block1', base_address: 0x0000, size: 0x1000 },
        { name: 'Block2', base_address: 0x1000, size: 0x2000 },
      ];

      const result = repackBlocksBackward(blocks, 1);

      // Last block stays in place
      expect(result[1].base_address).toBe(0x1000);
      expect(result[0].base_address).toBeGreaterThanOrEqual(0);
    });

    it('should clamp to address 0', () => {
      const blocks = [
        { name: 'Block1', base_address: 0x1000, size: 0x5000 }, // Too large
        { name: 'Block2', base_address: 0x2000, size: 0x1000 },
      ];

      const result = repackBlocksBackward(blocks, 0);

      // Should clamp block 0 to address 0
      expect(result[0].base_address).toBe(0);
    });

    it('should preserve original array', () => {
      const blocks = [
        { name: 'Block1', base_address: 0x0000, size: 0x1000 },
        { name: 'Block2', base_address: 0x5000, size: 0x2000 },
      ];

      const result = repackBlocksBackward(blocks, 0);

      // Original unchanged
      expect(blocks[0].base_address).toBe(0x0000);
      expect(result).not.toBe(blocks);
    });

    it('should handle empty array', () => {
      const result = repackBlocksBackward([], 0);
      expect(result).toEqual([]);
    });

    it('should handle single block', () => {
      const blocks = [{ name: 'Block1', base_address: 0x5000, size: 0x1000 }];

      const result = repackBlocksBackward(blocks, 0);

      expect(result[0].base_address).toBe(0x5000);
    });
  });

  describe('Edge cases', () => {
    it('should handle zero-sized blocks', () => {
      const blocks = [
        { name: 'Block1', base_address: 0x0000, size: 0 },
        { name: 'Block2', base_address: 0x1000, size: 0x1000 },
      ];

      const forward = repackBlocksForward(blocks, 1);
      expect(forward[1].base_address).toBe(0); // After zero-sized block

      const backward = repackBlocksBackward(blocks, 0);
      expect(backward[0].base_address).toBeGreaterThanOrEqual(0);
    });

    it('should handle missing size property', () => {
      const blocks = [
        { name: 'Block1', base_address: 0x0000 } as any,
        { name: 'Block2', base_address: 0x1000, size: 0x1000 },
      ];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const forward = repackBlocksForward(blocks as any, 0);
      expect(forward[0].base_address).toBe(0);
    });

    it('should handle very large addresses', () => {
      const blocks = [
        { name: 'Block1', base_address: 0xffff0000, size: 0x1000 },
        { name: 'Block2', base_address: 0xffff5000, size: 0x1000 },
      ];

      const result = repackBlocksForward(blocks, 1);
      expect(result[1].base_address).toBe(0xffff1000);
    });
  });
});
