import yaml from 'js-yaml';
import { YamlValidator } from '../../../services/YamlValidator';
import { ExtensionError } from '../../../utils/ErrorHandler';

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
});
