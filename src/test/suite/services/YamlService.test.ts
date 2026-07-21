import { YamlService } from '../../../webview/services/YamlService';

/** Helper: cast cleanForYaml result to a plain object map for assertions. */
function asObj(v: unknown): Record<string, unknown> {
  return v as Record<string, unknown>;
}

/** Helper: cast cleanForYaml result to an array of plain object maps. */
function asArr(v: unknown): Array<Record<string, unknown>> {
  return v as Array<Record<string, unknown>>;
}

describe('YamlService', () => {
  describe('cleanForYaml', () => {
    it('should convert offset and width to bits format', () => {
      const input = {
        name: 'ENABLE',
        offset: 0,
        width: 1,
        access: 'read-write',
        description: 'Enable bit',
      };

      const result = asObj(YamlService.cleanForYaml(input));

      expect(result.bits).toBe('[0:0]');
      expect(result.offset).toBeUndefined();
      expect(result.width).toBeUndefined();
      expect(result.name).toBe('ENABLE');
      expect(result.access).toBe('read-write');
      expect(result.description).toBe('Enable bit');
    });

    it('should handle multi-bit fields correctly', () => {
      const input = {
        name: 'MODE',
        offset: 1,
        width: 2,
        access: 'read-write',
      };

      const result = asObj(YamlService.cleanForYaml(input));

      expect(result.bits).toBe('[2:1]');
      expect(result.offset).toBeUndefined();
      expect(result.width).toBeUndefined();
    });

    it('should remove bitRange field', () => {
      const input = {
        name: 'STATUS',
        offset: 4,
        width: 4,
        bitRange: [7, 4],
        access: 'read-only',
      };

      const result = asObj(YamlService.cleanForYaml(input));

      expect(result.bits).toBe('[7:4]');
      expect(result.offset).toBeUndefined();
      expect(result.width).toBeUndefined();
      expect(result.bitRange).toBeUndefined();
    });

    it('should handle nested objects with bit fields', () => {
      const input = {
        name: 'CTRL_REG',
        fields: [
          {
            name: 'ENABLE',
            offset: 0,
            width: 1,
          },
          {
            name: 'MODE',
            offset: 1,
            width: 2,
          },
        ],
      };

      const result = asObj(YamlService.cleanForYaml(input));
      const fields = result.fields as Array<Record<string, unknown>>;

      expect(fields).toHaveLength(2);
      expect(fields[0].bits).toBe('[0:0]');
      expect(fields[0].offset).toBeUndefined();
      expect(fields[1].bits).toBe('[2:1]');
      expect(fields[1].offset).toBeUndefined();
    });

    it('should handle arrays of fields', () => {
      const input = [
        {
          name: 'ENABLE',
          offset: 0,
          width: 1,
        },
        {
          name: 'MODE',
          offset: 1,
          width: 2,
        },
      ];

      const result = asArr(YamlService.cleanForYaml(input));

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

      const result = YamlService.cleanForYaml(input) as Record<string, unknown>;

      // The serializer strips size:32 (schema default) from register-like objects.
      expect(result.name).toBe('CTRL_REG');
      expect(result.offset).toBe(0);
      expect(result.access).toBe('read-write');
      expect(result.size).toBeUndefined();
    });

    it('should preserve opaque maps containing offset and width keys', () => {
      const input = {
        name: 'MODE',
        bits: '[1:0]',
        enumeratedValues: {
          offset: 'enum-offset',
          width: 'enum-width',
        },
        customMetadata: {
          offset: 3,
          width: 2,
          label: 'keep',
        },
      };

      const result = asObj(YamlService.cleanForYaml(input));

      expect(result.enumeratedValues).toEqual(input.enumeratedValues);
      expect(result.customMetadata).toEqual(input.customMetadata);
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
            offset: 0,
            width: 1,
            access: 'read-write',
          },
        ],
      };

      const yaml = YamlService.dump(input);

      expect(yaml).toContain("bits: '[0:0]'");
      expect(yaml).not.toContain('offset');
      expect(yaml).not.toContain('width');
      expect(yaml).not.toContain('bitRange');
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

      const result = asObj(YamlService.parse(yaml));

      expect(result.name).toBe('Test');
      const fields = result.fields as Array<Record<string, unknown>>;
      expect(fields[0].name).toBe('ENABLE');
      expect(fields[0].bits).toBe('[0:0]');
    });
  });

  describe('safeParse', () => {
    it('should return null for invalid YAML', () => {
      const invalidYaml = '{ invalid: yaml: syntax';
      const warn = console.warn as jest.Mock;

      const result = YamlService.safeParse(invalidYaml);

      expect(result).toBeNull();
      expect(warn).toHaveBeenCalledWith('YAML parse error:', expect.any(Error));
      warn.mockClear();
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
        offset: 0,
        width: 1,
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
        offset: 4,
        width: 4,
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
