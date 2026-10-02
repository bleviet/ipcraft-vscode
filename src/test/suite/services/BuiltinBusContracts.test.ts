import type { BusDefinitionEntry, VlnvAlias } from '../../../domain/busDefinition.types';
import { builtinBusDefinitions, builtinBusLibrary } from '../../helpers/busLibrary';

const builtinFiles = {
  AXI4_LITE: 'axi4_lite.yml',
  AXI4_FULL: 'axi4_full.yml',
  AXI_STREAM: 'axi_stream.yml',
  AVALON_MEMORY_MAPPED: 'avalon_mm.yml',
  AVALON_STREAMING: 'avalon_st.yml',
} as const;

const compatibilityAliases = {
  AXI4_LITE: ['AXI4L', 'AXI4LITE', 'AXILITE', 'AXIL', 'axi4_lite', 'axi4-lite', 'axi4l'],
  AXI4_FULL: ['AXI4F', 'AXI4FULL', 'AXI4', 'axi4_full', 'axi4-full', 'axi4f'],
  AXI_STREAM: ['AXIS', 'AXI4S', 'AXISTREAM', 'axi_stream', 'axi-stream'],
  AVALON_MEMORY_MAPPED: [
    'AVMM',
    'AVALONMM',
    'AVALONMEMORYMAPPED',
    'AVALON_MEMORY_MAPPED',
    'avalon_mm',
    'avalon-mm',
    'avalon_memory',
  ],
  AVALON_STREAMING: [
    'AVST',
    'AVALONST',
    'AVALONSTREAMING',
    'avalon_st',
    'avalon-st',
    'avalon_stream',
  ],
} as const;

const expectedKindsAndModes = {
  AXI4_LITE: ['memoryMapped', 'master', 'slave'],
  AXI4_FULL: ['memoryMapped', 'master', 'slave'],
  AXI_STREAM: ['streaming', 'master', 'slave'],
  AVALON_MEMORY_MAPPED: ['memoryMapped', 'master', 'slave'],
  AVALON_STREAMING: ['streaming', 'source', 'sink'],
} as const;

const expectedRuleInventory = {
  AXI4_LITE: ['AXI4L_DATA_WIDTH', 'AXI4L_DATA_EQUAL', 'AXI4L_WSTRB_WIDTH', 'AXI4L_ADDRESS_EQUAL'],
  AXI4_FULL: ['AXI4_DATA_WIDTH', 'AXI4_DATA_EQUAL', 'AXI4_WSTRB_WIDTH', 'AXI4_ID_WIDTHS'],
  AXI_STREAM: [
    'AXIS_DATA_BYTE_ALIGNED',
    'AXIS_TKEEP_WIDTH',
    'AXIS_TSTRB_WIDTH',
    'AXIS_PREFERRED_DATA_WIDTH',
  ],
  AVALON_MEMORY_MAPPED: [
    'AVALON_MM_DATA_WIDTH',
    'AVALON_MM_DATA_EQUAL',
    'AVALON_MM_BYTEENABLE_WIDTH',
  ],
  AVALON_STREAMING: [
    'AVALON_ST_DATA_LAYOUT',
    'AVALON_ST_EMPTY_WIDTH',
    'AVALON_ST_PACKET_PORTS',
    'AVALON_ST_READY_LATENCY',
    'AVALON_ST_MAX_CHANNEL',
  ],
} as const;

function loadBuiltin<K extends keyof typeof builtinFiles>(key: K): BusDefinitionEntry {
  return builtinBusDefinitions()[key];
}

describe('built-in bus contracts', () => {
  it.each(Object.keys(builtinFiles) as Array<keyof typeof builtinFiles>)(
    '%s has a complete version-1 contract',
    (key) => {
      const definition = loadBuiltin(key);
      const [interfaceKind, producer, consumer] = expectedKindsAndModes[key];

      expect(definition.contract).toMatchObject({
        version: 1,
        interfaceKind,
        modePolicy: { producer, consumer },
      });
      expect(definition.ports.length).toBeGreaterThan(0);
      for (const port of definition.ports) {
        expect(['clock', 'reset', 'data', 'byteQualifier', 'control']).toContain(port.role);
        expect(['root', 'derived', 'fixed']).toContain(port.widthPolicy);
      }
    }
  );

  it.each(Object.keys(compatibilityAliases) as Array<keyof typeof compatibilityAliases>)(
    '%s retains its complete short-alias inventory',
    (key) => {
      const aliases = loadBuiltin(key).aliases ?? [];
      const shortAliases = aliases
        .filter((alias) => alias.kind === 'short')
        .map((alias) => alias.value);

      expect(shortAliases).toEqual(expect.arrayContaining([...compatibilityAliases[key]]));
    }
  );

  it('does not assign a normalized alias to different built-ins', () => {
    const owners = new Map<string, string>();

    for (const key of Object.keys(builtinFiles) as Array<keyof typeof builtinFiles>) {
      for (const alias of loadBuiltin(key).aliases ?? []) {
        const normalized =
          alias.kind === 'short'
            ? `short:${alias.value.trim().toLowerCase()}`
            : `vlnv:${alias.vendor}:${alias.library}:${alias.name}:${alias.version}`;
        const existing = owners.get(normalized);
        expect(existing === undefined || existing === key).toBe(true);
        owners.set(normalized, key);
      }
    }
  });

  it('declares the foreign Avalon VLNV compatibility aliases', () => {
    const avalonMmAliases = (loadBuiltin('AVALON_MEMORY_MAPPED').aliases ?? []).filter(
      (alias): alias is VlnvAlias => alias.kind === 'vlnv'
    );
    const avalonStAliases = (loadBuiltin('AVALON_STREAMING').aliases ?? []).filter(
      (alias): alias is VlnvAlias => alias.kind === 'vlnv'
    );

    expect(avalonMmAliases).toEqual(
      expect.arrayContaining([
        {
          kind: 'vlnv',
          vendor: 'xilinx.com',
          library: 'interface',
          name: 'avalon',
          version: '*',
        },
        {
          kind: 'vlnv',
          vendor: 'xilinx.com',
          library: 'interface',
          name: 'avalon-mm',
          version: '*',
        },
      ])
    );
    expect(avalonStAliases).toEqual(
      expect.arrayContaining([
        {
          kind: 'vlnv',
          vendor: 'xilinx.com',
          library: 'interface',
          name: 'avalon-st',
          version: '*',
        },
        {
          kind: 'vlnv',
          vendor: 'altera.com',
          library: 'interface',
          name: 'avalon_streaming',
          version: '*',
        },
      ])
    );
  });

  it.each(Object.keys(expectedRuleInventory) as Array<keyof typeof expectedRuleInventory>)(
    '%s declares the stable rule inventory',
    (key) => {
      const constraints = loadBuiltin(key).contract?.constraints ?? [];

      for (const ruleId of expectedRuleInventory[key]) {
        expect(constraints).toContainEqual(expect.objectContaining({ ruleId, code: ruleId }));
      }

      const warnings = constraints.filter((constraint) => constraint.severity === 'warning');
      if (key === 'AXI_STREAM') {
        expect(warnings.map((constraint) => constraint.ruleId)).toEqual([
          'AXIS_PREFERRED_DATA_WIDTH',
        ]);
      } else {
        expect(warnings).toEqual([]);
      }
    }
  );

  it('declares polarity only on canonical configurable Avalon-MM ports', () => {
    const avalon = loadBuiltin('AVALON_MEMORY_MAPPED');

    expect(avalon.ports.filter((port) => port.polarity).map((port) => port.name)).toEqual([
      'read',
      'write',
      'byteenable',
      'readdatavalid',
      'waitrequest',
    ]);
    expect(avalon.ports.some((port) => port.name.endsWith('_n'))).toBe(false);
  });

  it('declares Avalon-ST symbol semantics without duplicating endianness', () => {
    const properties = loadBuiltin('AVALON_STREAMING').contract?.interfaceProperties;

    expect(properties).toMatchObject({
      dataBitsPerSymbol: { type: 'integer', default: 8, minimum: 1 },
      symbolsPerBeat: { type: 'integer', minimum: 1 },
      readyLatency: { type: 'integer', default: 0, minimum: 0 },
      maxChannel: { type: 'integer', minimum: 0 },
    });
    expect(properties).not.toHaveProperty('firstSymbolInHighOrderBits');
    expect(properties?.symbolsPerBeat.derive).toBeDefined();
    expect(properties?.maxChannel.derive).toEqual({
      operation: 'maxEncodableValue',
      port: 'channel',
    });
  });

  it('normalizes every bundled definition without diagnostics', () => {
    const library = builtinBusLibrary();

    expect(Object.keys(library.definitions)).toHaveLength(5);
    expect(library.diagnostics).toEqual([]);
  });
});
