import {
  sanitizeFieldForYaml,
  sanitizeRegisterForYaml,
  sanitizeBlockForYaml,
  sanitizeMemoryMapForYaml,
} from '../../../webview/services/YamlSanitizer';

describe('YamlSanitizer', () => {
  describe('sanitizeFieldForYaml', () => {
    it('strips runtime bit keys and keeps canonical bits string', () => {
      const out = sanitizeFieldForYaml({
        name: 'ENABLE',
        bits: '[0:0]',
        bit_offset: 0,
        bit_width: 1,
        bit_range: [0, 0],
        access: 'read-write',
        description: 'Global enable',
      });
      expect(out).toEqual({
        name: 'ENABLE',
        bits: '[0:0]',
        access: 'read-write',
        description: 'Global enable',
      });
    });

    it('derives bits from runtime offsets when bits is missing', () => {
      const out = sanitizeFieldForYaml({ name: 'F', bit_offset: 4, bit_width: 4 });
      expect(out.bits).toBe('[7:4]');
      expect(out.bit_offset).toBeUndefined();
    });

    it('renames aliases to schema keys and drops null defaults', () => {
      const out = sanitizeFieldForYaml({
        name: 'F',
        bits: '[1:0]',
        reset_value: 3,
        enumerated_values: { '0': 'OFF' },
        monitorChangeOf: null,
        description: '',
      });
      expect(out).toEqual({
        name: 'F',
        bits: '[1:0]',
        resetValue: 3,
        enumeratedValues: { '0': 'OFF' },
      });
    });

    it('preserves unknown extension keys', () => {
      const out = sanitizeFieldForYaml({ name: 'F', bits: '[0:0]', x_vendor: 'abc' });
      expect(out.x_vendor).toBe('abc');
    });
  });

  describe('sanitizeRegisterForYaml', () => {
    it('strips address_offset and __kind, keeps canonical offset', () => {
      const out = sanitizeRegisterForYaml({
        name: 'CTRL',
        address_offset: 8,
        __kind: 'array',
        access: 'read-write',
      });
      expect(out).toEqual({ name: 'CTRL', offset: 8, access: 'read-write' });
    });

    it('drops default size 32 but keeps deviating sizes', () => {
      expect(sanitizeRegisterForYaml({ name: 'A', size: 32 }).size).toBeUndefined();
      expect(sanitizeRegisterForYaml({ name: 'B', size: 64 }).size).toBe(64);
      // size 32 is meaningful when the block default differs
      expect(sanitizeRegisterForYaml({ name: 'C', size: 32 }, 16).size).toBe(32);
    });

    it('sanitizes nested fields and array template registers', () => {
      const out = sanitizeRegisterForYaml({
        name: 'ARR',
        count: 2,
        stride: 4,
        registers: [{ name: 'reg0', address_offset: 0, fields: [] }],
      });
      const child = (out.registers as Record<string, unknown>[])[0];
      expect(child.address_offset).toBeUndefined();
      expect(child.offset).toBe(0);
      expect(child.fields).toBeUndefined();
    });
  });

  describe('sanitizeBlockForYaml', () => {
    it('converts base_address to baseAddress and drops empty register_arrays', () => {
      const out = sanitizeBlockForYaml({
        name: 'B',
        base_address: 12,
        register_arrays: [],
        registers: [{ name: 'reg1', address_offset: 0, size: 32 }],
      });
      expect(out).toEqual({
        name: 'B',
        baseAddress: 12,
        registers: [{ name: 'reg1', offset: 0 }],
      });
    });

    it('keeps defaultRegWidth and uses it for register size pruning', () => {
      const out = sanitizeBlockForYaml({
        name: 'B',
        baseAddress: 0,
        defaultRegWidth: 16,
        registers: [{ name: 'r', size: 32 }],
      });
      expect(out.defaultRegWidth).toBe(16);
      expect((out.registers as Record<string, unknown>[])[0].size).toBe(32);
    });
  });

  describe('sanitizeMemoryMapForYaml', () => {
    it('canonicalizes the blocks key and recurses', () => {
      const out = sanitizeMemoryMapForYaml({
        name: 'MAP',
        description: '',
        address_blocks: [{ name: 'B', base_address: 0 }],
      });
      expect(out).toEqual({
        name: 'MAP',
        addressBlocks: [{ name: 'B', baseAddress: 0 }],
      });
    });
  });
});
