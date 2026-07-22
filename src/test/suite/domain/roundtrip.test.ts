import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';

import { parseMemoryMap, parseIpCore } from '../../../domain/parse';
import { serializeMemoryMap, serializeIpCore, serializeValue } from '../../../domain/serialize';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FIXTURES_DIR = path.join(REPO_ROOT, 'src', 'test', 'fixtures');
const EXAMPLES_DIR = path.join(REPO_ROOT, 'ipcraft-spec', 'examples');

const IP_CORE_SCHEMA_PATH = path.join(REPO_ROOT, 'ipcraft-spec', 'schemas', 'ip_core.schema.json');
const MEMORY_MAP_SCHEMA_PATH = path.join(
  REPO_ROOT,
  'ipcraft-spec',
  'schemas',
  'memory_map.schema.json'
);

describe('Domain Model Parse/Serialize Round-trips', () => {
  let ajv: Ajv;
  let validateIpCore: ReturnType<Ajv['compile']>;
  let validateMemoryMap: ReturnType<Ajv['compile']>;

  beforeAll(() => {
    ajv = new Ajv({ strict: false, allowUnionTypes: true });

    const ipCoreSchema = JSON.parse(fs.readFileSync(IP_CORE_SCHEMA_PATH, 'utf8'));
    validateIpCore = ajv.compile(ipCoreSchema);

    const rawMemoryMapSchema = JSON.parse(fs.readFileSync(MEMORY_MAP_SCHEMA_PATH, 'utf8'));
    const memoryMapSchema = {
      ...rawMemoryMapSchema,
      $defs: rawMemoryMapSchema.items?.$defs,
    };
    validateMemoryMap = ajv.compile(memoryMapSchema);
  });

  function getYamlFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) {
      return results;
    }
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (file === 'custom_bus_definitions') {
          continue;
        }
        results.push(...getYamlFiles(fullPath));
      } else if (file.endsWith('.yml') || file.endsWith('.yaml')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const testFiles = [...getYamlFiles(FIXTURES_DIR), ...getYamlFiles(EXAMPLES_DIR)].filter(
    (f) => !f.includes('invalid-syntax') && !f.endsWith('.ipci.yml')
  );

  for (const filePath of testFiles) {
    const relativePath = path.relative(REPO_ROOT, filePath);

    it(`should parse and serialize cleanly: ${relativePath}`, () => {
      const content = fs.readFileSync(filePath, 'utf8');
      const isIpCore = filePath.endsWith('.ip.yml') || relativePath.includes('-ipcore');

      if (isIpCore) {
        // Parse IP Core
        const parsed = parseIpCore(content);
        expect(parsed).toBeDefined();

        // Serialize IP Core
        const serialized = serializeIpCore(parsed);
        expect(serialized).toBeDefined();

        // Validate serialized structure against schema
        const valid = validateIpCore(serialized);
        if (!valid) {
          const errors = validateIpCore.errors
            ? JSON.stringify(validateIpCore.errors, null, 2)
            : 'Unknown validation error';
          throw new Error(
            `Serialized IP Core schema validation failed for ${relativePath}:\n${errors}`
          );
        }
      } else {
        // Parse Memory Map
        const parsedDoc = parseMemoryMap(content);
        expect(parsedDoc).toBeDefined();
        expect(parsedDoc.map).toBeDefined();

        // Serialize Memory Map
        const serialized = serializeMemoryMap(parsedDoc.map, parsedDoc.rootStyle);
        expect(serialized).toBeDefined();

        // Validate serialized structure against schema
        const arrayDoc = Array.isArray(serialized) ? serialized : [serialized];
        const valid = validateMemoryMap(arrayDoc);
        if (!valid) {
          const errors = validateMemoryMap.errors
            ? JSON.stringify(validateMemoryMap.errors, null, 2)
            : 'Unknown validation error';
          fail(`Serialized Memory Map schema validation failed for ${relativePath}:\n${errors}`);
        }

        // Assert that the serialized object contains only camelCase properties
        const serializedStr = JSON.stringify(serialized);
        for (const snakeKey of [
          'address_offset',
          'base_address',
          'bit_offset',
          'bit_width',
          'bit_range',
          '__kind',
          'reset_value',
          'enumerated_values',
          'monitor_change_of',
        ]) {
          expect(serializedStr).not.toContain(`"${snakeKey}"`);
        }
      }
    });
  }
});

describe('serializeValue strips UI-only field properties', () => {
  it('removes the camelCase bitRange computed by the visualizer/cascade', () => {
    const field = {
      name: 'A',
      bits: '[7:4]',
      offset: 4,
      width: 4,
      bitRange: [7, 4],
      access: 'read-write',
    };

    const result = serializeValue(field) as Record<string, unknown>;

    expect('bitRange' in result).toBe(false);
    expect('offset' in result).toBe(false);
    expect('width' in result).toBe(false);
    expect(result.bits).toBe('[7:4]');
  });
});

describe('parseIpCore physicalPrefix handling', () => {
  it('should default to s_axi_ for non-conduit bus interfaces when absent', () => {
    const yamlStr = `
vlnv: foo:bar:baz:1.0
busInterfaces:
  - name: my_bus
    type: my_type
    mode: slave
`;
    const parsed = parseIpCore(yamlStr);
    expect(parsed.busInterfaces?.[0]?.physicalPrefix).toBe('s_axi_');
  });

  it('should default to empty string for conduit bus interfaces when absent', () => {
    const yamlStr = `
vlnv: foo:bar:baz:1.0
busInterfaces:
  - name: my_bus
    type: my_type
    mode: conduit
`;
    const parsed = parseIpCore(yamlStr);
    expect(parsed.busInterfaces?.[0]?.physicalPrefix).toBe('');
  });

  it('should preserve explicitly empty or null physicalPrefix as empty string', () => {
    const yamlStr1 = `
vlnv: foo:bar:baz:1.0
busInterfaces:
  - name: my_bus
    type: my_type
    mode: slave
    physicalPrefix: null
`;
    const parsed1 = parseIpCore(yamlStr1);
    expect(parsed1.busInterfaces?.[0]?.physicalPrefix).toBe('');

    const yamlStr2 = `
vlnv: foo:bar:baz:1.0
busInterfaces:
  - name: my_bus
    type: my_type
    mode: slave
    physicalPrefix: ""
`;
    const parsed2 = parseIpCore(yamlStr2);
    expect(parsed2.busInterfaces?.[0]?.physicalPrefix).toBe('');
  });
});

describe('parseIpCore parameter displayName handling', () => {
  it('should round-trip an explicit displayName through parse and serialize', () => {
    const yamlStr = `
vlnv: foo:bar:baz:1.0
parameters:
  - name: AXI_ID_WIDTH
    displayName: AXI ID Width
    value: 4
`;
    const parsed = parseIpCore(yamlStr);
    expect(parsed.parameters?.[0]?.displayName).toBe('AXI ID Width');

    const serialized = serializeIpCore(parsed) as Record<string, unknown>;
    const params = serialized.parameters as Array<Record<string, unknown>>;
    expect(params[0].displayName).toBe('AXI ID Width');
  });

  it('should leave displayName undefined when absent, not derive it from name', () => {
    const yamlStr = `
vlnv: foo:bar:baz:1.0
parameters:
  - name: AXI_ID_WIDTH
    value: 4
`;
    const parsed = parseIpCore(yamlStr);
    expect(parsed.parameters?.[0]?.displayName).toBeUndefined();
  });
});

describe('parseIpCore endianness handling', () => {
  it('round-trips explicitly authored little-endian values', () => {
    const parsed = parseIpCore(`
vlnv: foo:bar:baz:1.0
ports:
  - name: data
    direction: in
    width: 32
    endianness: little
busInterfaces:
  - name: stream
    type: ipcraft:busif:axis:1.0
    mode: slave
    endianness: little
`);

    const serialized = serializeIpCore(parsed) as Record<string, unknown>;
    expect((serialized.ports as Array<Record<string, unknown>>)[0].endianness).toBe('little');
    expect((serialized.busInterfaces as Array<Record<string, unknown>>)[0].endianness).toBe(
      'little'
    );
  });

  it('leaves implicit endianness absent', () => {
    const parsed = parseIpCore(`
vlnv: foo:bar:baz:1.0
ports:
  - name: data
    direction: in
    width: 32
busInterfaces:
  - name: stream
    type: ipcraft:busif:axis:1.0
    mode: slave
`);

    const serialized = serializeIpCore(parsed) as Record<string, unknown>;
    expect((serialized.ports as Array<Record<string, unknown>>)[0].endianness).toBeUndefined();
    expect(
      (serialized.busInterfaces as Array<Record<string, unknown>>)[0].endianness
    ).toBeUndefined();
  });
});
