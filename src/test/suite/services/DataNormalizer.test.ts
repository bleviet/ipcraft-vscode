import { DataNormalizer } from '../../../webview/services/DataNormalizer';

describe('DataNormalizer', () => {
  describe('parseNumber', () => {
    it('parses numbers and numeric strings with fallback handling', () => {
      expect(DataNormalizer.parseNumber(42, 1)).toBe(42);
      expect(DataNormalizer.parseNumber(' 0x10 ', 1)).toBe(16);
      expect(DataNormalizer.parseNumber('12.5', 1)).toBe(12.5);
      expect(DataNormalizer.parseNumber('', 7)).toBe(7);
      expect(DataNormalizer.parseNumber('abc', 7)).toBe(7);
      expect(DataNormalizer.parseNumber(Number.NaN, 7)).toBe(7);
      expect(DataNormalizer.parseNumber(null, 7)).toBe(7);
    });
  });

  describe('getDefaultRegBytes', () => {
    it('computes bytes from default width and clamps to at least 1 byte', () => {
      expect(DataNormalizer.getDefaultRegBytes({ defaultRegWidth: 64 })).toBe(8);
      expect(DataNormalizer.getDefaultRegBytes({ default_reg_width: '16' })).toBe(2);
      expect(DataNormalizer.getDefaultRegBytes({ defaultRegWidth: 0 })).toBe(1);
      expect(DataNormalizer.getDefaultRegBytes({})).toBe(4);
    });
  });

  describe('normalizeField', () => {
    it('normalizes from bits range strings and falls back on invalid numerics', () => {
      const range = DataNormalizer.normalizeField({ name: 'FIELD_A', bits: '[7:4]' });
      const single = DataNormalizer.normalizeField({ name: 'FIELD_B', bits: '[2]' });
      const fallback = DataNormalizer.normalizeField({
        name: 'FIELD_C',
        bit_offset: 'x',
        bit_width: 0,
      });

      expect(range.bit_offset).toBe(4);
      expect(range.bit_width).toBe(4);
      expect(single.bit_offset).toBe(2);
      expect(single.bit_width).toBe(1);
      expect(fallback.bit_offset).toBe(0);
      expect(fallback.bit_width).toBe(1);
    });

    it('maps reset aliases and enumerated values', () => {
      const field = DataNormalizer.normalizeField({
        name: 'MODE',
        bit_offset: 1,
        bit_width: 2,
        reset: 3,
        enumerated_values: { '0': 'IDLE', '1': 'RUN' },
      });

      expect(field.reset_value).toBe(3);
      expect(field.enumerated_values).toEqual({ '0': 'IDLE', '1': 'RUN' });
    });
  });

  describe('normalizeRegisterList', () => {
    it('normalizes explicit offsets, scalar registers, and register arrays', () => {
      const result = DataNormalizer.normalizeRegisterList(
        [
          { name: 'CTRL', offset: 8, fields: [{ name: 'EN', bits: '[0:0]' }] },
          {
            name: 'ARR',
            count: 2,
            stride: 8,
            registers: [{ name: 'ELEM', size: '32' }],
          },
          { name: 'STATUS' },
        ],
        4
      );

      expect(result[0]).toEqual(
        expect.objectContaining({
          name: 'CTRL',
          address_offset: 8,
          size: 32,
        })
      );

      expect(result[1]).toEqual(
        expect.objectContaining({
          __kind: 'array',
          name: 'ARR',
          address_offset: 12,
          count: 2,
          stride: 8,
        })
      );

      expect(result[2]).toEqual(
        expect.objectContaining({
          name: 'STATUS',
          address_offset: 28,
        })
      );
    });
  });

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

    it('normalizes register arrays and block defaults', () => {
      const input = {
        name: 'map',
        address_blocks: [
          {
            name: 'blk',
            offset: '0x20',
            default_reg_width: 16,
            registers: [{ name: 'R0' }, { name: 'R1' }],
            register_arrays: [
              {
                name: 'RA',
                base_address: '0x40',
                count: '2',
                stride: '4',
                template: { name: 'TMPL', offset: 1 },
              },
            ],
          },
        ],
      };

      const result = DataNormalizer.normalizeMemoryMap(input);
      const block = result.address_blocks?.[0];

      expect(block?.base_address).toBe(32);
      expect(block?.registers?.[0]?.address_offset).toBe(0);
      expect(block?.registers?.[1]?.address_offset).toBe(2);
      expect(block?.register_arrays?.[0]).toEqual(
        expect.objectContaining({
          name: 'RA',
          base_address: 64,
          count: 2,
          stride: 4,
        })
      );
      const firstArray = block?.register_arrays?.[0] as unknown as {
        template?: { name?: string };
      };
      expect(firstArray.template?.name).toBe('TMPL');
    });
  });
});
