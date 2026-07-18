import * as path from 'path';
import yaml from 'js-yaml';
import { YamlValidator } from '../../../services/YamlValidator';
import { ExtensionError } from '../../../utils/ErrorHandler';

const IP_CORE_SCHEMA_PATH = path.resolve(
  __dirname,
  '../../../../ipcraft-spec/schemas/ip_core.schema.json'
);

describe('YamlValidator', () => {
  let validator: YamlValidator;

  beforeEach(() => {
    validator = new YamlValidator();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('validates valid YAML and returns parsed data', () => {
    const result = validator.validate('name: test\nwidth: 32\n');

    expect(result.valid).toBe(true);
    expect(result.data).toEqual({ name: 'test', width: 32 });
    expect(result.error).toBeUndefined();
  });

  it('returns invalid result with message for malformed YAML', () => {
    const result = validator.validate('name: [invalid');

    expect(result.valid).toBe(false);
    expect(result.error).toEqual(expect.any(String));
  });

  it('parses valid YAML through parse()', () => {
    const parsed = validator.parse('registers:\n  - name: CTRL\n');

    expect(parsed).toEqual({ registers: [{ name: 'CTRL' }] });
  });

  it('throws ExtensionError with YAML_PARSE_ERROR for invalid parse()', () => {
    expect(() => validator.parse('name: [invalid')).toThrow(ExtensionError);

    try {
      validator.parse('name: [invalid');
      throw new Error('expected parse to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ExtensionError);
      const extensionError = error as ExtensionError;
      expect(extensionError.code).toBe('YAML_PARSE_ERROR');
      expect(extensionError.message).toContain('YAML parse error:');
    }
  });

  it('dumps data to YAML using configured formatting options', () => {
    const dumpSpy = jest.spyOn(yaml, 'dump');
    const source = { name: 'core', fields: [{ name: 'enable', bits: '[0:0]' }] };

    const serialized = validator.dump(source);

    expect(serialized).toContain('name: core');
    expect(dumpSpy).toHaveBeenCalledWith(source, {
      noRefs: true,
      sortKeys: false,
      lineWidth: -1,
      indent: 2,
    });
  });

  it('throws ExtensionError with YAML_DUMP_ERROR when serialization fails', () => {
    jest.spyOn(yaml, 'dump').mockImplementation(() => {
      throw new Error('dump failed');
    });

    expect(() => validator.dump({ name: 'core' })).toThrow(ExtensionError);

    try {
      validator.dump({ name: 'core' });
      throw new Error('expected dump to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ExtensionError);
      const extensionError = error as ExtensionError;
      expect(extensionError.code).toBe('YAML_DUMP_ERROR');
      expect(extensionError.message).toContain('Failed to serialize YAML: dump failed');
    }
  });

  describe('findDuplicatePhysicalPrefixes', () => {
    it('returns empty array for null input', () => {
      expect(validator.findDuplicatePhysicalPrefixes(null)).toEqual([]);
    });

    it('returns empty array for non-object input', () => {
      expect(validator.findDuplicatePhysicalPrefixes('string')).toEqual([]);
      expect(validator.findDuplicatePhysicalPrefixes(42)).toEqual([]);
    });

    it('returns empty array when there are no bus interfaces', () => {
      expect(validator.findDuplicatePhysicalPrefixes({ name: 'my_core' })).toEqual([]);
    });

    it('returns empty array when busInterfaces is empty', () => {
      expect(validator.findDuplicatePhysicalPrefixes({ busInterfaces: [] })).toEqual([]);
    });

    it('returns empty array when all prefixes are unique', () => {
      const data = {
        busInterfaces: [
          { name: 'axi_a', physicalPrefix: 'a_' },
          { name: 'axi_b', physicalPrefix: 'b_' },
        ],
      };
      expect(validator.findDuplicatePhysicalPrefixes(data)).toEqual([]);
    });

    it('returns one entry when two interfaces share the same physicalPrefix', () => {
      const data = {
        busInterfaces: [
          { name: 'axi_a', physicalPrefix: 's_axi_' },
          { name: 'axi_b', physicalPrefix: 's_axi_' },
        ],
      };
      const result = validator.findDuplicatePhysicalPrefixes(data);
      expect(result).toHaveLength(1);
      expect(result[0].prefix).toBe('s_axi_');
      expect(result[0].interfaces).toContain('axi_a');
      expect(result[0].interfaces).toContain('axi_b');
    });

    it('returns multiple entries when several prefix groups are duplicated', () => {
      const data = {
        busInterfaces: [
          { name: 'a1', physicalPrefix: 'x_' },
          { name: 'a2', physicalPrefix: 'x_' },
          { name: 'b1', physicalPrefix: 'y_' },
          { name: 'b2', physicalPrefix: 'y_' },
        ],
      };
      const result = validator.findDuplicatePhysicalPrefixes(data);
      expect(result).toHaveLength(2);
      const prefixes = result.map((r) => r.prefix).sort();
      expect(prefixes).toEqual(['x_', 'y_']);
    });

    it('supports snake_case bus_interfaces key', () => {
      const data = {
        bus_interfaces: [
          { name: 'axi_a', physical_prefix: 's_axi_' },
          { name: 'axi_b', physical_prefix: 's_axi_' },
        ],
      };
      const result = validator.findDuplicatePhysicalPrefixes(data);
      expect(result).toHaveLength(1);
      expect(result[0].prefix).toBe('s_axi_');
    });

    it('skips interfaces without a physicalPrefix', () => {
      const data = {
        busInterfaces: [{ name: 'no_prefix' }, { name: 'has_prefix', physicalPrefix: 'p_' }],
      };
      expect(validator.findDuplicatePhysicalPrefixes(data)).toEqual([]);
    });
  });

  describe('validateAgainstSchema', () => {
    it('reuses a schema validator across repeated validation', () => {
      const data = { vlnv: { vendor: 'test', library: 'lib', name: 'core', version: '1.0' } };

      expect(validator.validateAgainstSchema(data, IP_CORE_SCHEMA_PATH)).toEqual({ valid: true });
      expect(validator.validateAgainstSchema(data, IP_CORE_SCHEMA_PATH)).toEqual({ valid: true });
    });

    it('returns valid: true for a minimal conforming IP core', () => {
      const data = { vlnv: { vendor: 'test', library: 'lib', name: 'core', version: '1.0' } };
      const result = validator.validateAgainstSchema(data, IP_CORE_SCHEMA_PATH);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns valid: true when simulation block is present and correct', () => {
      const data = {
        vlnv: { vendor: 'test', library: 'lib', name: 'core', version: '1.0' },
        simulation: { framework: 'vunit', engine: 'ghdl' },
      };
      const result = validator.validateAgainstSchema(data, IP_CORE_SCHEMA_PATH);
      expect(result.valid).toBe(true);
    });

    it('rejects unknown simulation.engine with a path-aware error message', () => {
      const data = {
        vlnv: { vendor: 'test', library: 'lib', name: 'core', version: '1.0' },
        simulation: { engine: 'typo' },
      };
      const result = validator.validateAgainstSchema(data, IP_CORE_SCHEMA_PATH);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('simulation.engine');
    });

    it('rejects unknown simulation.framework', () => {
      const data = {
        vlnv: { vendor: 'test', library: 'lib', name: 'core', version: '1.0' },
        simulation: { framework: 'makefile' },
      };
      const result = validator.validateAgainstSchema(data, IP_CORE_SCHEMA_PATH);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('simulation.framework');
    });

    it('accepts simulation.vendorOptions with free-form content', () => {
      const data = {
        vlnv: { vendor: 'test', library: 'lib', name: 'core', version: '1.0' },
        simulation: {
          engine: 'questa',
          vendorOptions: { questa: { vsim_flags: ['-O2'], optimize: true } },
        },
      };
      const result = validator.validateAgainstSchema(data, IP_CORE_SCHEMA_PATH);
      expect(result.valid).toBe(true);
    });

    it('returns valid: false with error for unknown schema path', () => {
      const result = validator.validateAgainstSchema({}, '/non/existent/schema.json');
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('rejects data missing the required vlnv field', () => {
      const result = validator.validateAgainstSchema(
        { description: 'no vlnv' },
        IP_CORE_SCHEMA_PATH
      );
      expect(result.valid).toBe(false);
      expect(result.error).toContain('vlnv');
    });

    it('accepts a custom conduit interface with a null physicalPrefix (grouped signals, no explicit prefix)', () => {
      const data = {
        vlnv: { vendor: 'test', library: 'lib', name: 'core', version: '1.0' },
        description: null,
        busInterfaces: [
          {
            name: 'fifo_write',
            type: 'user:busif:fifo_write:1.0',
            mode: 'conduit',
            physicalPrefix: null,
            conduitPorts: [
              { name: 'fifo_write', direction: 'out', presence: 'required' },
              { name: 'fifo_almost_full', direction: 'in', presence: 'required' },
            ],
          },
        ],
      };
      const result = validator.validateAgainstSchema(data, IP_CORE_SCHEMA_PATH);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('accepts null for parameters[].description/uiPage/uiGroup and resets[].logicalName', () => {
      const data = {
        vlnv: { vendor: 'test', library: 'lib', name: 'core', version: '1.0' },
        parameters: [{ name: 'WIDTH', description: null, uiPage: null, uiGroup: null }],
        resets: [{ name: 'rst_n', logicalName: null }],
      };
      const result = validator.validateAgainstSchema(data, IP_CORE_SCHEMA_PATH);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });
});
