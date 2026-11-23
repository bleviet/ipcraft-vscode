/**
 * Schema coverage for IP core versioning: `vlnv.versionScheme`, apiVersion 1.2, `$version`
 * reset-value tokens, and `MemoryMap.versionHistory`.
 */
import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';
import { YamlValidator } from '../../../services/YamlValidator';

const SCHEMAS_DIR = path.resolve(__dirname, '../../../../ipcraft-spec/schemas');
const IP_CORE_SCHEMA_PATH = path.join(SCHEMAS_DIR, 'ip_core.schema.json');
const MEMORY_MAP_SCHEMA_PATH = path.join(SCHEMAS_DIR, 'memory_map.schema.json');

const HASH_A = 'rs1-3f9a0c41d2b7e6a5';
const HASH_B = 'rs1-0123456789abcdef';

describe('ip_core schema: versionScheme and apiVersion 1.3', () => {
  const validator = new YamlValidator();
  const core = (vlnv: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    vlnv: { vendor: 'acme', library: 'ip', name: 'uart', version: '1.4.2', ...vlnv },
    ...extra,
  });
  const validate = (data: unknown) => validator.validateAgainstSchema(data, IP_CORE_SCHEMA_PATH);

  it.each(['free', 'major.minor', 'major.minor.patch', 'major.feature.minor.patch'])(
    'accepts versionScheme %s',
    (versionScheme) => {
      expect(validate(core({ versionScheme }))).toEqual({ valid: true });
    }
  );

  it('accepts a vlnv without versionScheme', () => {
    expect(validate(core({}))).toEqual({ valid: true });
  });

  it.each(['semver', 'MAJOR.MINOR', 'major.minor.patch.build', '', 3, null])(
    'rejects versionScheme %p',
    (versionScheme) => {
      expect(validate(core({ versionScheme })).valid).toBe(false);
    }
  );

  it.each(['1.0', '1.1', '1.2', '1.3'])('accepts apiVersion %s', (apiVersion) => {
    expect(validate(core({}, { apiVersion }))).toEqual({ valid: true });
  });

  it('rejects an apiVersion newer than 1.3', () => {
    expect(validate(core({}, { apiVersion: '1.4' })).valid).toBe(false);
  });

  it('documents versionScheme and the 1.3 apiVersion', () => {
    const schema = JSON.parse(fs.readFileSync(IP_CORE_SCHEMA_PATH, 'utf8')) as {
      $defs: {
        VLNV: {
          properties: Record<string, { default?: string; enum?: string[] }>;
          required: string[];
        };
      };
      properties: { apiVersion: { enum: string[]; description: string } };
    };
    const { VLNV } = schema.$defs;
    expect(VLNV.properties.versionScheme.default).toBe('free');
    expect(VLNV.required).not.toContain('versionScheme');
    expect(schema.properties.apiVersion.enum).toEqual(['1.0', '1.1', '1.2', '1.3']);
    expect(schema.properties.apiVersion.description).toMatch(
      /Version 1\.3 adds vlnv\.versionScheme, \$version reset values and versionHistory/
    );
  });
});

describe('ip_core schema: tokens in inline memory maps', () => {
  const validator = new YamlValidator();
  const inlineCore = (map: Record<string, unknown>) => ({
    vlnv: { vendor: 'acme', library: 'ip', name: 'uart', version: '1.4.2' },
    memoryMaps: [map],
  });
  const inlineMap = (registers: unknown[], extra: Record<string, unknown> = {}) =>
    inlineCore({ name: 'CSR', addressBlocks: [{ name: 'REGS', registers }], ...extra });
  const validate = (data: unknown): boolean =>
    validator.validateAgainstSchema(data, IP_CORE_SCHEMA_PATH).valid;
  const field = (resetValue: unknown) => ({ name: 'F', bits: '[7:0]', resetValue });
  const tokens = [
    '$version',
    '$version.major',
    '$version.feature',
    '$version.minor',
    '$version.patch',
    '$version.crc8',
    '$version.crc16',
  ];

  it.each(tokens)('accepts %s on an inline bit field', (token) => {
    expect(validate(inlineMap([{ name: 'R', offset: 0, fields: [field(token)] }]))).toBe(true);
  });

  it.each(tokens)('accepts %s on an inline register', (token) => {
    expect(validate(inlineMap([{ name: 'R', offset: 0, resetValue: token }]))).toBe(true);
  });

  it('still accepts integers and null inline', () => {
    expect(
      validate(inlineMap([{ name: 'R', offset: 0, resetValue: 5, fields: [field(null)] }]))
    ).toBe(true);
  });

  it.each([
    '$version.foo',
    '$ver',
    '$version.',
    '$version.Major',
    '$version.crc',
    '$version.crc32',
    '$version.CRC8',
    ' $version',
    'version',
    '',
  ])('rejects %p inline', (token) => {
    expect(validate(inlineMap([{ name: 'R', offset: 0, fields: [field(token)] }]))).toBe(false);
    expect(validate(inlineMap([{ name: 'R', offset: 0, resetValue: token }]))).toBe(false);
  });

  it('rejects versionHistory on an inline memory map', () => {
    const versionHistory = { registerSets: {}, versions: [] };
    expect(validate(inlineMap([], { versionHistory }))).toBe(false);
  });
});

describe('memory_map schema: $version tokens and versionHistory', () => {
  // The schema nests $defs under `items` while $refs use root-relative pointers
  // (#/$defs/...); hoist them so ajv can resolve (same as SpecConformance).
  const rawSchema = JSON.parse(fs.readFileSync(MEMORY_MAP_SCHEMA_PATH, 'utf8')) as {
    items?: { $defs?: object };
  } & Record<string, unknown>;
  const validateSchema = new Ajv({ strict: false, allowUnionTypes: true }).compile({
    ...rawSchema,
    $defs: rawSchema.items?.$defs,
  });
  const valid = (data: unknown): boolean => validateSchema(data) === true;

  const map = (
    registers: unknown[],
    extra: Record<string, unknown> = {}
  ): Array<Record<string, unknown>> => [
    { name: 'CSR', addressBlocks: [{ name: 'REGS', registers }], ...extra },
  ];
  const field = (resetValue: unknown) => ({ name: 'F', bits: '[7:0]', resetValue });
  const register = (resetValue: unknown) => ({ name: 'R', offset: 0, resetValue });

  describe('reset value tokens', () => {
    const tokens = [
      '$version',
      '$version.major',
      '$version.feature',
      '$version.minor',
      '$version.patch',
      '$version.crc8',
      '$version.crc16',
    ];

    it.each(tokens)('accepts %s on a bit field', (token) => {
      expect(valid(map([{ name: 'R', offset: 0, fields: [field(token)] }]))).toBe(true);
    });

    it.each(tokens)('accepts %s on a register', (token) => {
      expect(valid(map([register(token)]))).toBe(true);
    });

    it('still accepts integers and null', () => {
      expect(
        valid(map([{ name: 'R', offset: 0, resetValue: 5, fields: [field(null), field(7)] }]))
      ).toBe(true);
    });

    it.each([
      '$version.foo',
      '$ver',
      '$version.',
      '$version.Major',
      '$version.crc',
      '$version.crc32',
      '$versions',
      ' $version',
      'version',
      '',
    ])('rejects %p on a bit field', (token) => {
      expect(valid(map([{ name: 'R', offset: 0, fields: [field(token)] }]))).toBe(false);
    });

    it.each([
      '$version.foo',
      '$ver',
      '$version.',
      '$version.Major',
      '$version.crc',
      '$version.crc32',
      '$versions',
      ' $version',
      'version',
      '',
    ])('rejects %p on a register', (token) => {
      expect(valid(map([register(token)]))).toBe(false);
    });

    it('still rejects other types', () => {
      expect(valid(map([register(1.5)]))).toBe(false);
      expect(valid(map([register(true)]))).toBe(false);
    });
  });

  describe('versionHistory', () => {
    const snapshot = [
      {
        name: 'REGS',
        registers: [
          {
            name: 'VERSION',
            offset: 0,
            fields: [{ name: 'MAJOR', bits: '[23:16]', resetValue: '$version.major' }],
          },
        ],
      },
    ];
    const history = (overrides: Record<string, unknown> = {}) => ({
      registerSets: { [HASH_A]: { addressBlocks: snapshot } },
      versions: [
        { version: '1.4.1', registerSet: HASH_A },
        { version: '1.4.2', registerSet: HASH_A },
      ],
      ...overrides,
    });
    const withHistory = (versionHistory: unknown) => map([], { versionHistory });

    it('accepts a valid history, snapshots keeping tokens symbolic', () => {
      expect(valid(withHistory(history()))).toBe(true);
    });

    it('accepts several sets and empty collections', () => {
      expect(
        valid(
          withHistory(
            history({
              registerSets: {
                [HASH_A]: { addressBlocks: snapshot },
                [HASH_B]: { addressBlocks: [] },
              },
            })
          )
        )
      ).toBe(true);
      expect(valid(withHistory({ registerSets: {}, versions: [] }))).toBe(true);
    });

    it.each([
      'rs1-3F9A0C41D2B7E6A5',
      'rs1-3f9a0c41d2b7e6a',
      'rs2-3f9a0c41d2b7e6a5',
      '3f9a0c41d2b7e6a5',
      'rs1-3f9a0c41d2b7e6a5a',
    ])('rejects the registerSets key %s', (key) => {
      expect(valid(withHistory(history({ registerSets: { [key]: { addressBlocks: [] } } })))).toBe(
        false
      );
    });

    it('accepts the recorded CRCs of a version entry, as optional integers in range', () => {
      const entry = (extra: Record<string, unknown>) =>
        withHistory(history({ versions: [{ version: '1.4.2', registerSet: HASH_A, ...extra }] }));
      expect(valid(entry({ crc8: 100, crc16: 5930 }))).toBe(true);
      expect(valid(entry({ crc8: 0, crc16: 0 }))).toBe(true);
      expect(valid(entry({ crc8: 255, crc16: 65535 }))).toBe(true);
      expect(valid(entry({ crc8: 100 }))).toBe(true);
      expect(valid(entry({ crc16: 5930 }))).toBe(true);
    });

    it.each([
      { crc8: 256 },
      { crc8: -1 },
      { crc8: 1.5 },
      { crc8: '0x64' },
      { crc16: 65536 },
      { crc16: -1 },
      { crc16: null },
    ])('rejects the CRC value %p', (extra) => {
      expect(
        valid(
          withHistory(history({ versions: [{ version: '1.4.2', registerSet: HASH_A, ...extra }] }))
        )
      ).toBe(false);
    });

    it('rejects a version entry without registerSet', () => {
      expect(valid(withHistory(history({ versions: [{ version: '1.0.0' }] })))).toBe(false);
    });

    it('rejects a version entry without version', () => {
      expect(valid(withHistory(history({ versions: [{ registerSet: HASH_A }] })))).toBe(false);
    });

    it('rejects an empty version string and a malformed registerSet reference', () => {
      expect(
        valid(withHistory(history({ versions: [{ version: '', registerSet: HASH_A }] })))
      ).toBe(false);
      expect(
        valid(withHistory(history({ versions: [{ version: '1.0', registerSet: 'nope' }] })))
      ).toBe(false);
    });

    it('rejects a missing registerSets or versions', () => {
      expect(valid(withHistory({ versions: [] }))).toBe(false);
      expect(valid(withHistory({ registerSets: {} }))).toBe(false);
    });

    it('rejects unknown keys at every level', () => {
      expect(valid(withHistory(history({ extra: 1 })))).toBe(false);
      expect(
        valid(
          withHistory(history({ versions: [{ version: '1.0', registerSet: HASH_A, note: 'x' }] }))
        )
      ).toBe(false);
      expect(
        valid(withHistory(history({ registerSets: { [HASH_A]: { addressBlocks: [], extra: 1 } } })))
      ).toBe(false);
    });

    it('rejects a registerSet without addressBlocks', () => {
      expect(valid(withHistory(history({ registerSets: { [HASH_A]: {} } })))).toBe(false);
    });

    it('validates snapshots against the address block schema', () => {
      const bad = [{ name: 'REGS', registers: [{ name: 'R', resetValue: '$version.nope' }] }];
      expect(
        valid(withHistory(history({ registerSets: { [HASH_A]: { addressBlocks: bad } } })))
      ).toBe(false);
    });

    it('is optional', () => {
      expect(valid(map([]))).toBe(true);
    });
  });
});
