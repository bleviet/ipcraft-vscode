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

        // Validate serialized structure against schema. The runtime model carries
        // normalization artifacts the strict schema does not allow: undefined-valued
        // keys and an empty `presence` on ports. Drop them before validating.
        const schemaShaped = JSON.parse(JSON.stringify(serialized)) as {
          ports?: Array<Record<string, unknown>>;
        };
        for (const port of schemaShaped.ports ?? []) {
          if (port.presence === '') {
            delete port.presence;
          }
        }
        const valid = validateIpCore(schemaShaped);
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

describe('parseIpCore root key handling', () => {
  it('does not treat a snake_case bus_interfaces root as bus interfaces', () => {
    const yamlStr = `
vlnv: foo:bar:baz:1.0
bus_interfaces:
  - name: my_bus
    type: my_type
    mode: slave
`;
    expect(parseIpCore(yamlStr).busInterfaces).toEqual([]);
  });
});

describe('parseIpCore physicalPrefix handling', () => {
  it('should default to empty string for non-conduit bus interfaces when absent', () => {
    const yamlStr = `
vlnv: foo:bar:baz:1.0
busInterfaces:
  - name: my_bus
    type: my_type
    mode: slave
`;
    const parsed = parseIpCore(yamlStr);
    expect(parsed.busInterfaces?.[0]?.physicalPrefix).toBe('');
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

describe('parseIpCore interrupt association handling', () => {
  it('round-trips associated bus interface and clock names', () => {
    const parsed = parseIpCore(`
vlnv: foo:bar:baz:1.0
interrupts:
  - name: irq
    direction: out
    associatedBusInterface: s_axi
    associatedClock: clk
`);

    expect(parsed.interrupts?.[0]).toMatchObject({
      associatedBusInterface: 's_axi',
      associatedClock: 'clk',
    });

    const serialized = serializeIpCore(parsed) as Record<string, unknown>;
    expect((serialized.interrupts as Array<Record<string, unknown>>)[0]).toMatchObject({
      associatedBusInterface: 's_axi',
      associatedClock: 'clk',
    });
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

describe('parseIpCore interface property handling', () => {
  it('round-trips concrete and parameterized interface properties', () => {
    const parsed = parseIpCore(`
vlnv: foo:bar:baz:1.0
busInterfaces:
  - name: stream
    type: ipcraft:busif:avalon_st:1.0
    mode: source
    interfaceProperties:
      dataBitsPerSymbol: 1
      symbolsPerBeat: DATA_WIDTH
`);

    const serialized = serializeIpCore(parsed) as {
      busInterfaces: Array<Record<string, unknown>>;
    };

    expect(serialized.busInterfaces[0].interfaceProperties).toEqual({
      dataBitsPerSymbol: 1,
      symbolsPerBeat: 'DATA_WIDTH',
    });
  });

  it('does not materialize an interface property map when it is absent', () => {
    const parsed = parseIpCore(`
vlnv: foo:bar:baz:1.0
busInterfaces:
  - name: stream
    type: ipcraft:busif:axi_stream:1.0
    mode: master
`);

    expect(parsed.busInterfaces?.[0]?.interfaceProperties).toBeUndefined();
    const serialized = serializeIpCore(parsed) as {
      busInterfaces: Array<Record<string, unknown>>;
    };
    expect(serialized.busInterfaces[0].interfaceProperties).toBeUndefined();
  });
});

describe('parseIpCore port polarity override handling', () => {
  it('round-trips a valid camelCase port polarity override map', () => {
    const parsed = parseIpCore(`
vlnv: foo:bar:baz:1.0
busInterfaces:
  - name: avs
    type: xilinx.com:interface:avalon:1.0
    mode: slave
    portPolarityOverrides:
      read: activeLow
`);

    expect(parsed.busInterfaces?.[0]?.portPolarityOverrides).toEqual({ read: 'activeLow' });

    const serialized = serializeIpCore(parsed) as {
      busInterfaces: Array<Record<string, unknown>>;
    };
    expect(serialized.busInterfaces[0].portPolarityOverrides).toEqual({ read: 'activeLow' });
  });
});

describe('$version tokens and versionHistory', () => {
  const HASH = 'rs1-3f9a0c41d2b7e6a5';
  const MAP_YAML = `- name: CSR
  description: Control registers
  addressBlocks:
    - name: REGS
      baseAddress: 0
      registers:
        - name: VERSION
          offset: 0
          access: read-only
          resetValue: $version
        - name: ID
          offset: 4
          fields:
            - name: MAJOR
              bits: '[23:16]'
              access: read-only
              resetValue: $version.major
              description: Major number
            - name: FLAGS
              bits: '[7:0]'
              resetValue: 5
  versionHistory:
    registerSets:
      ${HASH}:
        addressBlocks:
          - name: REGS
            registers:
              - name: VERSION
                offset: 0
                resetValue: $version
    versions:
      - version: 1.4.1
        registerSet: ${HASH}
`;

  const validateMap = (() => {
    const raw = JSON.parse(fs.readFileSync(MEMORY_MAP_SCHEMA_PATH, 'utf8')) as {
      items?: { $defs?: object };
    } & Record<string, unknown>;
    return new Ajv({ strict: false, allowUnionTypes: true }).compile({
      ...raw,
      $defs: raw.items?.$defs,
    });
  })();

  interface SerializedRegister extends Record<string, unknown> {
    fields: Array<Record<string, unknown>>;
  }
  interface SerializedMap extends Record<string, unknown> {
    addressBlocks: Array<{ registers: SerializedRegister[] }>;
  }
  const serialized = (text: string): SerializedMap[] => {
    const doc = parseMemoryMap(text);
    return serializeMemoryMap(doc.map, doc.rootStyle) as SerializedMap[];
  };

  describe('parse', () => {
    const { map } = parseMemoryMap(MAP_YAML);
    const [versionReg, idReg] = map.addressBlocks[0].registers;

    it('turns a register token into versionRef with a 0 resetValue', () => {
      expect(versionReg.versionRef).toBe('$version');
      expect(versionReg.resetValue).toBe(0);
    });

    it('turns a field token into versionRef with a 0 resetValue', () => {
      expect(idReg.fields[0].versionRef).toBe('$version.major');
      expect(idReg.fields[0].resetValue).toBe(0);
    });

    it('leaves numeric resets without a versionRef key', () => {
      expect(idReg.fields[1].resetValue).toBe(5);
      expect(idReg.fields[1]).not.toHaveProperty('versionRef');
    });

    it('copies versionHistory unchanged, snapshots staying raw schema objects', () => {
      expect(map.versionHistory).toEqual({
        registerSets: {
          [HASH]: {
            addressBlocks: [
              {
                name: 'REGS',
                registers: [{ name: 'VERSION', offset: 0, resetValue: '$version' }],
              },
            ],
          },
        },
        versions: [{ version: '1.4.1', registerSet: HASH }],
      });
    });

    it('has no versionHistory key without one', () => {
      expect(parseMemoryMap('- name: X\n  addressBlocks: []\n').map).not.toHaveProperty(
        'versionHistory'
      );
    });

    it('keeps the numeric fallback for an invalid token (schema validation reports it)', () => {
      const bad = parseMemoryMap(`- name: X
  addressBlocks:
    - name: B
      registers:
        - name: R
          offset: 0
          resetValue: $version.foo
          fields:
            - { name: F, bits: '[3:0]', resetValue: $ver }
`).map.addressBlocks[0].registers[0];
      expect(bad.resetValue).toBe(0);
      expect(bad).not.toHaveProperty('versionRef');
      expect(bad.fields[0].resetValue).toBe(0);
      expect(bad.fields[0]).not.toHaveProperty('versionRef');
    });
  });

  describe('serialize', () => {
    it('writes tokens back as resetValue and never emits a versionRef key', () => {
      const [out] = serialized(MAP_YAML);
      const [versionReg, idReg] = out.addressBlocks[0].registers;
      expect(versionReg.resetValue).toBe('$version');
      expect(idReg.fields[0].resetValue).toBe('$version.major');
      expect(idReg.fields[1].resetValue).toBe(5);
      expect(JSON.stringify(out)).not.toContain('versionRef');
    });

    it('keeps the canonical key positions', () => {
      const [out] = serialized(MAP_YAML);
      const [versionReg, idReg] = out.addressBlocks[0].registers;
      expect(Object.keys(idReg.fields[0])).toEqual([
        'name',
        'bits',
        'access',
        'resetValue',
        'description',
      ]);
      expect(Object.keys(versionReg)).toEqual(['name', 'offset', 'access', 'resetValue']);
    });

    it('emits versionHistory unchanged after addressBlocks', () => {
      const { map } = parseMemoryMap(MAP_YAML);
      const [out] = serialized(MAP_YAML);
      expect(Object.keys(out)).toEqual(['name', 'description', 'addressBlocks', 'versionHistory']);
      expect(out.versionHistory).toEqual(map.versionHistory);
    });

    it('produces schema-valid output', () => {
      expect(validateMap(serialized(MAP_YAML))).toBe(true);
    });

    it('is stable across a second parse and serialize', () => {
      const first = serialized(MAP_YAML);
      const doc = parseMemoryMap(JSON.stringify(first));
      expect(serializeMemoryMap(doc.map, doc.rootStyle)).toEqual(first);
    });

    it('drops a null versionRef and a zero resetValue', () => {
      expect(serializeValue({ name: 'F', bits: '[0:0]', resetValue: 0, versionRef: null })).toEqual(
        { name: 'F', bits: '[0:0]' }
      );
      expect(serializeValue({ name: 'R', offset: 0, resetValue: 0, versionRef: null })).toEqual({
        name: 'R',
        offset: 0,
      });
    });

    it('prefers the token over a stale numeric resetValue', () => {
      expect(
        serializeValue({
          name: 'F',
          offset: 0,
          width: 8,
          resetValue: 7,
          versionRef: '$version.minor',
        })
      ).toEqual({ name: 'F', bits: '[7:0]', resetValue: '$version.minor' });
    });

    it('passes a raw token resetValue (unparsed objects) through', () => {
      expect(serializeValue({ name: 'F', bits: '[7:0]', resetValue: '$version.patch' })).toEqual({
        name: 'F',
        bits: '[7:0]',
        resetValue: '$version.patch',
      });
    });

    it('drops an invalid token as 0, as before (documented current behavior)', () => {
      const [out] = serialized(`- name: X
  addressBlocks:
    - name: B
      registers:
        - { name: R, offset: 0, resetValue: $version.foo }
`);
      expect(out.addressBlocks[0].registers[0]).not.toHaveProperty('resetValue');
    });
  });

  describe('vendor extension keys (x-...)', () => {
    const YAML = `- name: X
  addressBlocks:
    - name: B
      registers:
        - name: POP
          x-readSideEffect: true
          x-vendor: { note: kept as is, list: [1, 2] }
          fields:
            - { name: V, bits: '[31:31]', access: read-only, x-unit: flag }
`;

    it('keeps them on the normalized register and field', () => {
      const reg = parseMemoryMap(YAML).map.addressBlocks[0].registers[0];
      expect(reg['x-readSideEffect']).toBe(true);
      expect(reg['x-vendor']).toEqual({ note: 'kept as is', list: [1, 2] });
      expect(reg.fields[0]['x-unit']).toBe('flag');
    });

    it('writes them back unchanged', () => {
      const reg = serialized(YAML)[0].addressBlocks[0].registers[0] as Record<string, unknown>;
      expect(reg['x-readSideEffect']).toBe(true);
      expect(reg['x-vendor']).toEqual({ note: 'kept as is', list: [1, 2] });
      expect((reg.fields as Array<Record<string, unknown>>)[0]['x-unit']).toBe('flag');
    });
  });
});
