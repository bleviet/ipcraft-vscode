import type { BusDefinitionFile } from '../../../domain/busDefinition.types';
import type { BusInterface, Parameter } from '../../../domain/ipcore.types';
import {
  normalizeBusLibrary,
  resolveBusInterface,
  validateBusInterfaces,
} from '../../../shared/busContracts';
import { blocksGeneration, checkBusConformance } from '../../../shared/busConformance';
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

  // v0.9.9-v1.0.0 VHDL imports wrote WSTRB as the data-width parameter.
  it('derives WSTRB from WDATA for a v1.0.0-style WSTRB override', () => {
    const result = resolve(
      {
        name: 's_axi',
        type: 'ipcraft:busif:axi4_lite:1.0',
        mode: 'slave',
        portWidthOverrides: {
          WDATA: 'AxiDataWidth_g',
          RDATA: 'AxiDataWidth_g',
          WSTRB: 'AxiDataWidth_g',
        },
      },
      [{ name: 'AxiDataWidth_g', value: 32, dataType: 'integer' } as unknown as Parameter]
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.authoredPortWidths).not.toHaveProperty('WSTRB');
    expect(result.portWidths.WSTRB).toMatchObject({ value: 4 });
  });

  it('still rejects a WSTRB override that differs from its derived width', () => {
    const result = resolve(
      {
        name: 's_axi',
        type: 'ipcraft:busif:axi4_lite:1.0',
        mode: 'slave',
        portWidthOverrides: { WDATA: 'AxiDataWidth_g', RDATA: 'AxiDataWidth_g', WSTRB: 'OTHER_W' },
      },
      [
        { name: 'AxiDataWidth_g', value: 32, dataType: 'integer' } as unknown as Parameter,
        { name: 'OTHER_W', value: 32, dataType: 'integer' } as unknown as Parameter,
      ]
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'BUS_DERIVED_WIDTH_OVERRIDE' })
    );
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

  // Intel altera_trace_printf_monitor: read-only slave, byteenable = CAPTURE_DATAWIDTH/8.
  it('derives byteenable from readdata on a read-only Avalon-MM slave', () => {
    const readOnly = (byteenable: number) =>
      resolve({
        name: 'control',
        type: 'AVMM',
        mode: 'slave',
        useOptionalPorts: ['read', 'readdata', 'byteenable'],
        portWidthOverrides: { readdata: 16, byteenable },
      });

    expect(readOnly(2).diagnostics).toEqual([]);
    expect(readOnly(4).diagnostics).toContainEqual(
      expect.objectContaining({ code: 'AVALON_MM_BYTEENABLE_WIDTH' })
    );
  });

  it('derives maxChannel only when the channel port is active', () => {
    const withoutChannel = resolve({ name: 'stream', type: 'AVST', mode: 'source' });
    const withChannel = resolve({
      name: 'stream',
      type: 'AVST',
      mode: 'source',
      useOptionalPorts: ['channel'],
      portWidthOverrides: { channel: 2 },
    });

    expect(withoutChannel.properties.maxChannel?.value).toBeUndefined();
    expect(withChannel.properties.maxChannel).toMatchObject({ state: 'concrete', value: 3 });
  });

  it('accepts a derived maxChannel for every allowed channel width', () => {
    const result = resolve(
      {
        name: 'stream',
        type: 'AVST',
        mode: 'source',
        useOptionalPorts: ['channel'],
        portWidthOverrides: { channel: 'CH_W' },
      },
      [
        {
          name: 'CH_W',
          dataType: 'integer',
          value: 8,
          allowedValues: [4, 8],
        } as unknown as Parameter,
      ]
    );

    expect(hasRule(result, 'AVALON_ST_MAX_CHANNEL')).toBe(false);
  });

  it('still rejects an authored maxChannel that does not fit every allowed channel width', () => {
    const result = resolve(
      {
        name: 'stream',
        type: 'AVST',
        mode: 'source',
        useOptionalPorts: ['channel'],
        portWidthOverrides: { channel: 'CH_W' },
        interfaceProperties: { maxChannel: 255 },
      },
      [
        {
          name: 'CH_W',
          dataType: 'integer',
          value: 8,
          allowedValues: [4, 8],
        } as unknown as Parameter,
      ]
    );

    expect(hasRule(result, 'AVALON_ST_MAX_CHANNEL')).toBe(true);
  });
});

describe('bounded allowed-value domains', () => {
  function domainLibrary(message?: string) {
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
              ...(message ? { message } : {}),
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
      expect.objectContaining({
        code: 'DOMAIN_EQUAL',
        state: 'concrete',
        severity: 'error',
        message:
          "Interface 'domain': ports left, right must have the same width (fails for some allowed values of LEFT, RIGHT).",
      })
    );
    expect(result.diagnostics).not.toContainEqual(
      expect.objectContaining({ code: 'CONFORMANCE_DOMAIN_NOT_EXHAUSTIVE' })
    );
  });

  it('emits an authored constraint message verbatim', () => {
    const result = resolveBusInterface({
      busInterface: { name: 'domain', type: 'acme:busif:domain:1.0', mode: 'master' },
      busIndex: 0,
      parameters: parameters(16),
      library: domainLibrary('left and right differ'),
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'DOMAIN_EQUAL', message: 'left and right differ' })
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

describe('unknown memory map reference', () => {
  const bus = { name: 'bus', type: 'AXI4L', mode: 'slave', memoryMapRef: 'FOO' } as BusInterface;
  const validate = (memoryMapNames?: readonly string[]) =>
    validateBusInterfaces({ busInterfaces: [bus], parameters: [], library, memoryMapNames });

  it('reports a ref that names no defined map', () => {
    expect(validate(['CSR'])).toContainEqual(
      expect.objectContaining({
        code: 'BUS_MEMORY_MAP_UNKNOWN',
        severity: 'error',
        state: 'invalid',
        path: ['busInterfaces', 0, 'memoryMapRef'],
        message: "Interface 'bus' references unknown memory map 'FOO'.",
      })
    );
  });

  it('blocks generation through checkBusConformance', () => {
    const report = checkBusConformance({ busInterfaces: [bus] }, library, ['CSR']);
    expect(blocksGeneration(report)).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'BUS_MEMORY_MAP_UNKNOWN')).toBe(true);
  });

  it('accepts a known ref and skips the check when names are omitted', () => {
    expect(validate(['FOO']).some((d) => d.code === 'BUS_MEMORY_MAP_UNKNOWN')).toBe(false);
    expect(validate().some((d) => d.code === 'BUS_MEMORY_MAP_UNKNOWN')).toBe(false);
  });
});

describe('constraint message details', () => {
  it('names the invalid state for an illegal width', () => {
    const result = resolve({
      name: 'stream',
      type: 'AXIS',
      mode: 'master',
      portWidthOverrides: { TDATA: -1 },
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        ruleId: 'AXIS_DATA_BYTE_ALIGNED',
        message:
          "Interface 'stream': TDATA width must be a multiple of 8 (a referenced value is invalid).",
      })
    );
  });

  it('names the unresolved state for an undeclared parameter', () => {
    const result = resolve({
      name: 'stream',
      type: 'AXIS',
      mode: 'master',
      portWidthOverrides: { TDATA: 'MISSING' },
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        ruleId: 'AXIS_DATA_BYTE_ALIGNED',
        message:
          "Interface 'stream': TDATA width must be a multiple of 8 (a referenced value could not be resolved).",
      })
    );
  });

  it('reports the current and expected width for a quotient failure', () => {
    const result = resolve({
      name: 'stream',
      type: 'AXIS',
      mode: 'master',
      useOptionalPorts: ['TSTRB'],
      portWidthOverrides: { TDATA: 24, TSTRB: 4 },
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        ruleId: 'AXIS_TSTRB_WIDTH',
        message:
          "Interface 'stream': TSTRB width must equal TDATA width / 8 (currently 4, expected 3).",
      })
    );
  });

  it('reports the expected value for a rejected derived-width override', () => {
    const result = resolve({
      name: 'stream',
      type: 'AVST',
      mode: 'source',
      useOptionalPorts: ['empty'],
      portWidthOverrides: { data: 32, empty: 3 },
      interfaceProperties: { dataBitsPerSymbol: 8, symbolsPerBeat: 4 },
    });

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        ruleId: 'AVALON_ST_EMPTY_WIDTH',
        message:
          "Interface 'stream': interface property 'symbolsPerBeat' must be set when port empty is present (empty width is derived as 2).",
      })
    );
  });
});
