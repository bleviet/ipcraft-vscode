import type { BusDefinitionFile } from '../../../domain/busDefinition.types';
import type { BusInterface, Parameter } from '../../../domain/ipcore.types';
import {
  normalizeBusLibrary,
  resolveBusInterface,
  validateBusInterfaces,
} from '../../../shared/busContracts';
import { builtinBusLibrary } from '../../helpers/busLibrary';

const library = builtinBusLibrary();

function resolve(
  busInterface: Partial<BusInterface> & Pick<BusInterface, 'name' | 'type' | 'mode'>,
  parameters: Parameter[] = []
) {
  return resolveBusInterface({
    busInterface,
    busIndex: 0,
    parameters,
    library,
  });
}

function hasRule(result: ReturnType<typeof resolve>, ruleId: string): boolean {
  return result.diagnostics.some((diagnostic) => diagnostic.ruleId === ruleId);
}

describe('built-in conformance rules', () => {
  it.each([
    [32, 4, true],
    [64, 8, true],
    [20, 3, false],
  ])('validates AXIS TDATA=%i TKEEP=%i', (data, keep, valid) => {
    const result = resolve({
      name: 'stream',
      type: 'AXIS',
      mode: 'master',
      useOptionalPorts: ['TKEEP'],
      portWidthOverrides: { TDATA: data, TKEEP: keep },
    });

    expect(!hasRule(result, 'AXIS_DATA_BYTE_ALIGNED') && !hasRule(result, 'AXIS_TKEEP_WIDTH')).toBe(
      valid
    );
  });

  it('validates TSTRB width and reports non-power-of-two byte widths as a warning', () => {
    const result = resolve({
      name: 'stream',
      type: 'AXIS',
      mode: 'master',
      useOptionalPorts: ['TSTRB'],
      portWidthOverrides: { TDATA: 24, TSTRB: 4 },
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ ruleId: 'AXIS_TSTRB_WIDTH', severity: 'error' })
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ ruleId: 'AXIS_PREFERRED_DATA_WIDTH', severity: 'warning' })
    );
  });

  it('accepts an Avalon-ST stream with one-bit symbols', () => {
    const result = resolve({
      name: 'stream',
      type: 'AVST',
      mode: 'source',
      useOptionalPorts: ['startofpacket', 'endofpacket', 'empty'],
      portWidthOverrides: { data: 4, empty: 2 },
      interfaceProperties: { dataBitsPerSymbol: 1, symbolsPerBeat: 4 },
    });

    expect(result.diagnostics).toEqual([]);
  });

  it('ignores an inactive empty port for a one-symbol Avalon-ST stream', () => {
    const result = resolve({
      name: 'stream',
      type: 'AVST',
      mode: 'source',
      portWidthOverrides: { data: 32 },
      interfaceProperties: { dataBitsPerSymbol: 32, symbolsPerBeat: 1 },
    });

    expect(result.activePorts.map((port) => port.name)).not.toContain('empty');
    expect(result.diagnostics).toEqual([]);
  });

  it('ignores a stale derived-width override after its optional port is disabled', () => {
    const result = resolve({
      name: 'stream',
      type: 'AVST',
      mode: 'source',
      portWidthOverrides: { data: 32, empty: 99 },
      interfaceProperties: { dataBitsPerSymbol: 8, symbolsPerBeat: 4 },
    });

    expect(result.activePorts.map((port) => port.name)).not.toContain('empty');
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ['AXI4L_DATA_WIDTH', 'AXI4L', { WDATA: 48 }],
    ['AXI4L_DATA_EQUAL', 'AXI4L', { WDATA: 32, RDATA: 64 }],
    ['AXI4L_WSTRB_WIDTH', 'AXI4L', { WDATA: 32, WSTRB: 8 }],
    ['AXI4L_ADDRESS_EQUAL', 'AXI4L', { AWADDR: 16, ARADDR: 32 }],
    ['AXI4_DATA_WIDTH', 'AXI4', { WDATA: 20 }],
    ['AXI4_DATA_EQUAL', 'AXI4', { WDATA: 32, RDATA: 64 }],
    ['AXI4_WSTRB_WIDTH', 'AXI4', { WDATA: 64, WSTRB: 4 }],
    ['AXI4_ID_WIDTHS', 'AXI4', { AWID: 2, BID: 1 }],
    ['AVALON_MM_DATA_WIDTH', 'AVMM', { writedata: 20 }],
    ['AVALON_MM_DATA_EQUAL', 'AVMM', { writedata: 32, readdata: 64 }],
    ['AVALON_MM_BYTEENABLE_WIDTH', 'AVMM', { writedata: 32, byteenable: 8 }],
  ])('emits %s for an invalid built-in override table', (ruleId, type, widths) => {
    const result = resolve({
      name: 'bus',
      type,
      mode: 'master',
      useOptionalPorts: Object.keys(widths),
      portWidthOverrides: widths,
    });

    expect(hasRule(result, ruleId)).toBe(true);
  });

  it.each([
    [
      'AVALON_ST_DATA_LAYOUT',
      {
        portWidthOverrides: { data: 16 },
        interfaceProperties: { dataBitsPerSymbol: 8, symbolsPerBeat: 4 },
      },
    ],
    [
      'AVALON_ST_EMPTY_WIDTH',
      {
        useOptionalPorts: ['startofpacket', 'endofpacket', 'empty'],
        portWidthOverrides: { data: 32, empty: 3 },
        interfaceProperties: { dataBitsPerSymbol: 8, symbolsPerBeat: 4 },
      },
    ],
    [
      'AVALON_ST_PACKET_PORTS',
      { useOptionalPorts: ['startofpacket'], portWidthOverrides: { data: 32 } },
    ],
    [
      'AVALON_ST_READY_LATENCY',
      { useOptionalPorts: ['ready'], interfaceProperties: { readyLatency: -1 } },
    ],
    [
      'AVALON_ST_MAX_CHANNEL',
      {
        useOptionalPorts: ['channel'],
        portWidthOverrides: { channel: 2 },
        interfaceProperties: { maxChannel: 4 },
      },
    ],
  ])('emits %s for invalid Avalon-ST semantics', (ruleId, partial) => {
    const result = resolve({ name: 'stream', type: 'AVST', mode: 'source', ...partial });

    expect(hasRule(result, ruleId)).toBe(true);
  });
});

describe('bounded allowed-value domains', () => {
  function domainLibrary() {
    const definitions: BusDefinitionFile = {
      DOMAIN: {
        busType: { vendor: 'acme', library: 'busif', name: 'domain', version: '1.0' },
        contract: {
          version: 1,
          interfaceKind: 'streaming',
          modePolicy: { producer: 'master', consumer: 'slave', aliases: {} },
          interfaceProperties: {},
          constraints: [
            {
              ruleId: 'DOMAIN_EQUAL',
              code: 'DOMAIN_EQUAL',
              kind: 'portWidthsEqual',
              ports: ['left', 'right'],
              severity: 'error',
            },
          ],
        },
        ports: [
          {
            name: 'left',
            width: 'LEFT',
            direction: 'out',
            presence: 'required',
            role: 'data',
            widthPolicy: 'root',
          },
          {
            name: 'right',
            width: 'RIGHT',
            direction: 'out',
            presence: 'required',
            role: 'data',
            widthPolicy: 'root',
          },
        ],
      },
    };
    return normalizeBusLibrary([
      { sourceFile: '/workspace/domain.yml', sourceKind: 'workspace', definitions },
    ]);
  }

  function parameters(leftCount: number): Parameter[] {
    return [
      {
        name: 'LEFT',
        value: 1,
        dataType: 'integer',
        allowedValues: Array.from({ length: leftCount }, (_, index) => index + 1),
      } as unknown as Parameter,
      {
        name: 'RIGHT',
        value: 1,
        dataType: 'integer',
        allowedValues: Array.from({ length: 16 }, (_, index) => index + 1),
      } as unknown as Parameter,
    ];
  }

  it('evaluates all 256 dependency-sliced combinations', () => {
    const result = resolveBusInterface({
      busInterface: {
        name: 'domain',
        type: 'acme:busif:domain:1.0',
        mode: 'master',
      },
      busIndex: 0,
      parameters: parameters(16),
      library: domainLibrary(),
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'DOMAIN_EQUAL', state: 'concrete', severity: 'error' })
    );
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'CONFORMANCE_DOMAIN_NOT_EXHAUSTIVE' })
    );
  });

  it('does not sample a 17-by-16 domain', () => {
    const result = resolveBusInterface({
      busInterface: {
        name: 'domain',
        type: 'acme:busif:domain:1.0',
        mode: 'master',
      },
      busIndex: 0,
      parameters: parameters(17),
      library: domainLibrary(),
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'CONFORMANCE_DOMAIN_NOT_EXHAUSTIVE',
        state: 'unresolved',
        severity: 'warning',
      })
    );
  });
});

describe('memory-map contract diagnostics', () => {
  it.each([
    ['user:busif:unknown:1.0', 'slave'],
    ['AXIS', 'slave'],
    ['AXI4L', 'master'],
  ])('rejects memoryMapRef on %s in %s mode', (type, mode) => {
    const busInterface = {
      name: 'bus',
      type,
      mode,
      memoryMapRef: 'CSR',
    } as BusInterface;
    const diagnostics = validateBusInterfaces({
      busInterfaces: [busInterface],
      parameters: [],
      library,
    });

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'BUS_MEMORY_MAP_UNSUPPORTED',
        path: ['busInterfaces', 0, 'memoryMapRef'],
      })
    );
  });

  it('rejects a memory map attached to an arrayed consumer interface', () => {
    const diagnostics = validateBusInterfaces({
      busInterfaces: [
        {
          name: 'bus',
          type: 'AXI4L',
          mode: 'slave',
          memoryMapRef: 'CSR',
          array: { count: 2 },
        } as BusInterface,
      ],
      parameters: [],
      library,
    });

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'BUS_MEMORY_MAP_UNSUPPORTED',
        path: ['busInterfaces', 0, 'memoryMapRef'],
      })
    );
  });
});

describe('legacy contract-less definitions', () => {
  it('keeps interface properties opaque and applies only structural validation', () => {
    const definitions: BusDefinitionFile = {
      LEGACY: {
        busType: { vendor: 'acme', library: 'busif', name: 'legacy', version: '1.0' },
        ports: [{ name: 'payload', width: 8, direction: 'out' }],
      },
    };
    const legacyLibrary = normalizeBusLibrary([
      { sourceFile: '/workspace/legacy.yml', sourceKind: 'workspace', definitions },
    ]);
    const diagnostics = validateBusInterfaces({
      busInterfaces: [
        {
          name: 'legacy',
          type: 'acme:busif:legacy:1.0',
          mode: 'master',
          interfaceProperties: { vendorOpaque: 42 },
        },
      ],
      parameters: [],
      library: legacyLibrary,
    });

    expect(legacyLibrary.definitions.LEGACY.version).toBeNull();
    expect(diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'BUS_UNKNOWN_INTERFACE_PROPERTY' })
    );
  });
});
