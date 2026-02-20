import { DataNormalizer } from '../../../webview/services/DataNormalizer';

describe('DataNormalizer', () => {
  describe('normalizeMemoryMap', () => {
    it('normalizes snake_case memory map keys', () => {
      const input = {
        name: 'test_map',
        address_blocks: [{ name: 'block0', base_address: 0, registers: [] }],
      };

      const result = DataNormalizer.normalizeMemoryMap(input);
      expect(result.name).toBe('test_map');
      expect(result.address_blocks).toHaveLength(1);
      expect(result.address_blocks?.[0]?.base_address).toBe(0);
    });

    it('normalizes camelCase memory map keys', () => {
      const input = {
        name: 'test_map',
        addressBlocks: [{ name: 'block0', baseAddress: 16, registers: [] }],
      };

      const result = DataNormalizer.normalizeMemoryMap(input);
      expect(result.address_blocks).toHaveLength(1);
      expect(result.address_blocks?.[0]?.base_address).toBe(16);
    });

    it('throws for null/undefined root values', () => {
      expect(() => DataNormalizer.normalizeMemoryMap(null)).toThrow();
      expect(() => DataNormalizer.normalizeMemoryMap(undefined)).toThrow();
    });
  });
});
