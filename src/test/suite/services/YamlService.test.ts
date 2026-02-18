import { YamlService } from '../../../webview/services/YamlService';

describe('YamlService', () => {
  describe('cleanForYaml', () => {
    it('should convert bit_offset and bit_width to bits format', () => {
      const input = {
        name: 'ENABLE',
        bit_offset: 0,
        bit_width: 1,
        access: 'read-write',
        description: 'Enable bit',
      };

      const result = YamlService.cleanForYaml(input);

      expect(result.bits).toBe('[0:0]');
      expect(result.bit_offset).toBeUndefined();
      expect(result.bit_width).toBeUndefined();
      expect(result.name).toBe('ENABLE');
      expect(result.access).toBe('read-write');
      expect(result.description).toBe('Enable bit');
    });

    it('should handle multi-bit fields correctly', () => {
      const input = {
        name: 'MODE',
        bit_offset: 1,
        bit_width: 2,
        access: 'read-write',
      };

      const result = YamlService.cleanForYaml(input);

      expect(result.bits).toBe('[2:1]');
      expect(result.bit_offset).toBeUndefined();
      expect(result.bit_width).toBeUndefined();
    });

    it('should remove bit_range field', () => {
      const input = {
        name: 'STATUS',
        bit_offset: 4,
        bit_width: 4,
        bit_range: [7, 4],
        access: 'read-only',
      };

      const result = YamlService.cleanForYaml(input);

      expect(result.bits).toBe('[7:4]');
      expect(result.bit_offset).toBeUndefined();
      expect(result.bit_width).toBeUndefined();
      expect(result.bit_range).toBeUndefined();
    });

    it('should handle nested objects with bit fields', () => {
      const input = {
        name: 'CTRL_REG',
        fields: [
          {
            name: 'ENABLE',
            bit_offset: 0,
            bit_width: 1,
          },
          {
            name: 'MODE',
            bit_offset: 1,
            bit_width: 2,
          },
        ],
      };

      const result = YamlService.cleanForYaml(input);

      expect(result.fields).toHaveLength(2);
      expect(result.fields[0].bits).toBe('[0:0]');
      expect(result.fields[0].bit_offset).toBeUndefined();
      expect(result.fields[1].bits).toBe('[2:1]');
      expect(result.fields[1].bit_offset).toBeUndefined();
    });

    it('should handle arrays of fields', () => {
      const input = [
        {
          name: 'ENABLE',
          bit_offset: 0,
          bit_width: 1,
        },
        {
          name: 'MODE',
          bit_offset: 1,
          bit_width: 2,
        },
      ];

      const result = YamlService.cleanForYaml(input);

      expect(result).toHaveLength(2);
      expect(result[0].bits).toBe('[0:0]');
      expect(result[1].bits).toBe('[2:1]');
    });

    it('should preserve objects without bit fields', () => {
      const input = {
        name: 'CTRL_REG',
        offset: 0x00,
        size: 32,
        access: 'read-write',
      };

      const result = YamlService.cleanForYaml(input);

      expect(result).toEqual(input);
    });

    it('should handle null and undefined', () => {
      expect(YamlService.cleanForYaml(null)).toBeNull();
      expect(YamlService.cleanForYaml(undefined)).toBeUndefined();
    });

    it('should handle primitive values', () => {
      expect(YamlService.cleanForYaml(42)).toBe(42);
      expect(YamlService.cleanForYaml('hello')).toBe('hello');
      expect(YamlService.cleanForYaml(true)).toBe(true);
    });
  });

  describe('dump', () => {
    it('should dump object with converted bit fields to YAML', () => {
      const input = {
        name: 'Test',
        fields: [
          {
            name: 'ENABLE',
            bit_offset: 0,
            bit_width: 1,
            access: 'read-write',
          },
        ],
      };

      const yaml = YamlService.dump(input);

      expect(yaml).toContain("bits: '[0:0]'");
      expect(yaml).not.toContain('bit_offset');
      expect(yaml).not.toContain('bit_width');
      expect(yaml).not.toContain('bit_range');
    });
  });

  describe('parse', () => {
    it('should parse YAML with bits field', () => {
      const yaml = `
name: Test
fields:
  - name: ENABLE
    bits: "[0:0]"
    access: read-write
`;

      const result = YamlService.parse(yaml);

      expect(result.name).toBe('Test');
      expect(result.fields[0].name).toBe('ENABLE');
      expect(result.fields[0].bits).toBe('[0:0]');
    });
  });

  describe('safeParse', () => {
    it('should return null for invalid YAML', () => {
      const invalidYaml = '{ invalid: yaml: syntax';

      const result = YamlService.safeParse(invalidYaml);

      expect(result).toBeNull();
    });

    it('should parse valid YAML', () => {
      const validYaml = 'name: Test';

      const result = YamlService.safeParse(validYaml);

      expect(result).toEqual({ name: 'Test' });
    });
  });

  describe('property order', () => {
    it('should output name before bits in YAML', () => {
      const input = {
        name: 'ENABLE',
        bit_offset: 0,
        bit_width: 1,
        access: 'read-write',
      };

      const yaml = YamlService.dump(input);

      // Check that 'name' appears before 'bits' in the output
      const nameIndex = yaml.indexOf('name:');
      const bitsIndex = yaml.indexOf('bits:');

      expect(nameIndex).toBeGreaterThan(-1);
      expect(bitsIndex).toBeGreaterThan(-1);
      expect(nameIndex).toBeLessThan(bitsIndex);
    });

    it('should preserve property order for fields with bits', () => {
      const input = {
        name: 'STATUS',
        bit_offset: 4,
        bit_width: 4,
        access: 'read-only',
        description: 'Status field',
      };

      const yaml = YamlService.dump(input);
      const lines = yaml.split('\n').filter((l) => l.trim());

      // Verify order: name, bits, access, description
      expect(lines[0]).toContain('name:');
      expect(lines[1]).toContain('bits:');
      expect(lines[2]).toContain('access:');
      expect(lines[3]).toContain('description:');
    });
  });
});
