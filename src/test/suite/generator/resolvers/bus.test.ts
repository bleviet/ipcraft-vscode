import { busResolver, buildUserPorts } from '../../../../generator/resolvers/bus';
import { normalizeIpCoreData } from '../../../../generator/registerProcessor';
import { BUS_REGISTRY } from '../../../../generator/buses/builtin';
import type { ResolverInput } from '../../../../generator/resolvers/types';
import type { BusDefinitions } from '../../../../generator/types';
import { builtinBusLibrary } from '../../../helpers/busLibrary';
import { normalizeBusLibrary, type NormalizedBusLibrary } from '../../../../shared/busContracts';
import type { BusDefinitionFile } from '../../../../domain/busDefinition.types';

const AXI4_LITE_DEF: BusDefinitions = {
  AXI4_LITE: {
    busType: { vendor: 'ipcraft', library: 'busif', name: 'axi4_lite', version: '1.0' },
    ports: [
      { name: 'ACLK', presence: 'required' },
      { name: 'ARESETn', presence: 'required' },
      { name: 'WDATA', width: 32, direction: 'out', presence: 'required', role: 'data' },
      { name: 'WSTRB', width: 4, direction: 'out', presence: 'required', role: 'byteQualifier' },
      { name: 'RDATA', width: 32, direction: 'in', presence: 'required', role: 'data' },
      { name: 'WVALID', direction: 'out', presence: 'required' },
    ],
  },
};

const AXI_STREAM_DEF: BusDefinitions = {
  AXI_STREAM: {
    busType: { vendor: 'ipcraft', library: 'busif', name: 'axi_stream', version: '1.0' },
    ports: [
      { name: 'ACLK', presence: 'required' },
      { name: 'ARESETn', presence: 'required' },
      { name: 'TDATA', width: 32, direction: 'out', presence: 'required', role: 'data' },
      { name: 'TVALID', direction: 'out', presence: 'required' },
    ],
  },
};

function makeInput(
  raw: Record<string, unknown>,
  busDefinitions: BusDefinitions = {},
  busLibrary: NormalizedBusLibrary = builtinBusLibrary()
): ResolverInput {
  return {
    ipCore: normalizeIpCoreData(raw),
    registers: [],
    busDefinitions,
    busLibrary,
    registry: BUS_REGISTRY,
  };
}

function customModeLibrary(): NormalizedBusLibrary {
  const definitions: BusDefinitionFile = {
    CUSTOM: {
      busType: { vendor: 'acme', library: 'busif', name: 'custom', version: '1.0' },
      contract: {
        version: 1,
        interfaceKind: 'streaming',
        modePolicy: { producer: 'initiator', consumer: 'target', aliases: {} },
        interfaceProperties: {},
        constraints: [],
      },
      ports: [
        {
          name: 'payload',
          width: 8,
          direction: 'out',
          presence: 'required',
          role: 'data',
          widthPolicy: 'root',
        },
      ],
    },
  };
  return normalizeBusLibrary([
    { sourceFile: '/workspace/custom.yml', sourceKind: 'workspace', definitions },
  ]);
}

function customSymbolLaneLibrary(): NormalizedBusLibrary {
  const definitions: BusDefinitionFile = {
    CUSTOM_SYMBOL_STREAM: {
      busType: {
        vendor: 'acme',
        library: 'busif',
        name: 'custom_symbol_stream',
        version: '1.0',
      },
      contract: {
        version: 1,
        interfaceKind: 'streaming',
        modePolicy: { producer: 'source', consumer: 'sink', aliases: {} },
        interfaceProperties: {
          dataBitsPerSymbol: { type: 'integer', minimum: 1 },
        },
        constraints: [],
      },
      ports: [
        {
          name: 'payload',
          width: 5,
          direction: 'out',
          presence: 'required',
          role: 'data',
          widthPolicy: 'root',
        },
      ],
    },
  };
  return normalizeBusLibrary([
    { sourceFile: '/workspace/custom-symbol.yml', sourceKind: 'workspace', definitions },
  ]);
}

describe('busResolver endianness', () => {
  it('uses a custom contract mode policy for direction and Quartus endpoint metadata', () => {
    const result = busResolver.resolve(
      makeInput(
        {
          busInterfaces: [
            {
              name: 'custom_target',
              type: 'acme:busif:custom:1.0',
              mode: 'target',
              physicalPrefix: 'custom_',
            },
          ],
        },
        {},
        customModeLibrary()
      )
    );

    expect(result.bus_ports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ logical_name: 'payload', direction: 'in' }),
      ])
    );
    expect(result.expanded_bus_interfaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'custom_target',
          normalized_mode: 'target',
          is_consumer: true,
          altera_end_type: 'end',
        }),
      ])
    );
  });

  it('marks no ports for swap when no interfaces are big-endian', () => {
    const result = busResolver.resolve(
      makeInput(
        {
          busInterfaces: [{ name: 's_axi', type: 'AXI4L', mode: 'slave' }],
        },
        AXI4_LITE_DEF
      )
    );
    expect(result.has_endian_swap).toBe(false);
    expect(result.endian_swap_ports).toEqual([]);
  });

  it('byte-swaps data ports and bit-reverses their byte qualifier, leaving control ports alone', () => {
    const result = busResolver.resolve(
      makeInput(
        {
          busInterfaces: [{ name: 's_axi', type: 'AXI4L', mode: 'slave', endianness: 'big' }],
        },
        AXI4_LITE_DEF
      )
    );
    expect(result.has_endian_swap).toBe(true);
    const swapPorts = result.endian_swap_ports as Array<{ name: string; swap_kind: string }>;
    const byName = Object.fromEntries(swapPorts.map((p) => [p.name, p.swap_kind]));
    // Data payload byte-reversed; the WSTRB mask bit-reversed in lockstep.
    expect(byName).toEqual({
      s_axi_wdata: 'lane',
      s_axi_rdata: 'lane',
      s_axi_wstrb: 'bit',
    });
    // Only fixed-width byte swaps need a swap_bytes_<width>() helper; WSTRB is a bit reversal.
    expect(result.endian_swap_widths).toEqual([32]);

    const busPorts = result.bus_ports as Array<{ logical_name: string; needs_swap?: boolean }>;
    expect(busPorts.find((p) => p.logical_name === 'WVALID')?.needs_swap).toBeFalsy();
  });

  it('does not reverse the byte qualifier when the interface is little-endian', () => {
    const result = busResolver.resolve(
      makeInput({ busInterfaces: [{ name: 's_axi', type: 'AXI4L', mode: 'slave' }] }, AXI4_LITE_DEF)
    );
    const busPorts = result.bus_ports as Array<{ logical_name: string; needs_swap?: boolean }>;
    expect(busPorts.find((p) => p.logical_name === 'WSTRB')?.needs_swap).toBeFalsy();
  });

  it('preserves the first interface as the public primary context when there is no memory-mapped slave', () => {
    // The templates route this primary stream interface directly to the core when there is
    // no memory-mapped wrapper. Keeping it in bus_ports preserves the 1.x context contract.
    const result = busResolver.resolve(
      makeInput(
        {
          busInterfaces: [
            {
              name: 'm_axis',
              type: 'AXIS',
              mode: 'master',
              physicalPrefix: 'm_axis_',
              endianness: 'big',
            },
          ],
        },
        AXI_STREAM_DEF
      )
    );
    expect((result.bus_ports as unknown[]).length).toBeGreaterThan(0);
    expect(result.bus_prefix).toBe('m_axis');
    const secondary = result.secondary_bus_interfaces as Array<{ name: string }>;
    expect(secondary).toEqual([]);
    expect(result.has_endian_swap).toBe(true);
    const swapNames = (result.endian_swap_ports as Array<{ name: string }>).map((p) => p.name);
    expect(swapNames).toEqual(['m_axis_tdata']);
  });

  it('keeps parameterized big-endian data ports out of the fixed-width helper list', () => {
    const result = busResolver.resolve(
      makeInput(
        {
          parameters: [{ name: 'DATA_WIDTH', value: 32 }],
          busInterfaces: [
            {
              name: 's_axi',
              type: 'AXI4L',
              mode: 'slave',
              endianness: 'big',
              portWidthOverrides: { WDATA: 'DATA_WIDTH', RDATA: 'DATA_WIDTH' },
            },
          ],
        },
        AXI4_LITE_DEF
      )
    );

    const swapPorts = result.endian_swap_ports as Array<{
      name: string;
      is_parameterized: boolean;
      swap_kind: string;
      lane_width: number | string;
    }>;
    const byName = Object.fromEntries(swapPorts.map((p) => [p.name, p]));
    // Parameterized data ports byte-swap via a width-generic generate loop, so they
    // contribute no fixed-width swap_bytes_<N>() helper.
    expect(byName['s_axi_wdata'].is_parameterized).toBe(true);
    expect(byName['s_axi_rdata'].is_parameterized).toBe(true);
    expect(byName['s_axi_wdata'].swap_kind).toBe('lane');
    expect(byName['s_axi_wdata'].lane_width).toBe(8);
    // WSTRB (byteQualifier) is a fixed 4-bit mask, reversed as bits — never a swap_bytes helper.
    expect(byName['s_axi_wstrb'].swap_kind).toBe('bit');
    expect(result.endian_swap_widths).toEqual([]);
  });

  it('reverses a parameterized byte qualifier even when its default width is one bit', () => {
    const result = busResolver.resolve(
      makeInput(
        {
          parameters: [{ name: 'DATA_WIDTH', value: 8 }],
          busInterfaces: [
            {
              name: 's_axi',
              type: 'AXI4L',
              mode: 'slave',
              endianness: 'big',
              portWidthOverrides: { WDATA: 'DATA_WIDTH', RDATA: 'DATA_WIDTH' },
            },
          ],
        },
        AXI4_LITE_DEF
      )
    );

    const swapPorts = result.endian_swap_ports as Array<{
      name: string;
      width: number;
      is_parameterized: boolean;
      swap_kind: string;
    }>;
    expect(swapPorts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 's_axi_wstrb',
          width: 1,
          is_parameterized: true,
          swap_kind: 'bit',
        }),
      ])
    );
  });

  it('allocates a collision-free internal swap signal name', () => {
    const result = busResolver.resolve(
      makeInput({
        ports: [
          { name: 'data', direction: 'in', width: 32, endianness: 'big' },
          { name: 'data_be', direction: 'in', width: 32 },
        ],
      })
    );

    const swapPorts = result.endian_swap_ports as Array<{
      name: string;
      internal_name: string;
    }>;
    expect(swapPorts).toEqual([
      expect.objectContaining({ name: 'data', internal_name: 'data_be_2' }),
    ]);
    expect((result.user_ports as Array<Record<string, unknown>>)[0].internal_name).toBe(
      'data_be_2'
    );
  });
});

describe('buildUserPorts endianness', () => {
  const paramNames: string[] = [];

  it('does not swap a little-endian (default) port', () => {
    const ports = buildUserPorts(
      normalizeIpCoreData({ ports: [{ name: 'data_in', direction: 'in', width: 32 }] }),
      paramNames
    );
    expect(ports[0].needs_swap).toBe(false);
  });

  it('swaps a big-endian port whose width is a multiple of 8', () => {
    const ports = buildUserPorts(
      normalizeIpCoreData({
        ports: [{ name: 'data_in', direction: 'in', width: 32, endianness: 'big' }],
      }),
      paramNames
    );
    expect(ports[0].needs_swap).toBe(true);
    expect(ports[0].lane_kind).toBe('byte');
  });

  it('does not swap a big-endian port whose width is not a multiple of 8', () => {
    const ports = buildUserPorts(
      normalizeIpCoreData({
        ports: [{ name: 'data_in', direction: 'in', width: 12, endianness: 'big' }],
      }),
      paramNames
    );
    expect(ports[0].needs_swap).toBe(false);
  });

  it('does not swap a big-endian inout port', () => {
    const ports = buildUserPorts(
      normalizeIpCoreData({
        ports: [{ name: 'data_io', direction: 'inout', width: 32, endianness: 'big' }],
      }),
      paramNames
    );
    expect(ports[0].needs_swap).toBe(false);
  });

  it('swaps a big-endian parameterized-width port via a width-generic loop', () => {
    const ports = buildUserPorts(
      normalizeIpCoreData({
        parameters: [{ name: 'DATA_WIDTH', value: 32 }],
        ports: [{ name: 'stream', direction: 'in', width: 'DATA_WIDTH', endianness: 'big' }],
      }),
      ['DATA_WIDTH']
    );
    expect(ports[0].is_parameterized).toBe(true);
    expect(ports[0].needs_swap).toBe(true);
    expect(ports[0].swap_kind).toBe('lane');
    expect(ports[0].lane_width).toBe(8);
    expect(ports[0].lane_kind).toBe('byte');
  });

  it('reverses a five-bit Avalon-ST payload in one-bit symbol lanes', () => {
    const result = busResolver.resolve(
      makeInput({
        busInterfaces: [
          {
            name: 'stream',
            type: 'ipcraft:busif:avalon_st:1.0',
            mode: 'source',
            physicalPrefix: 'stream_',
            endianness: 'big',
            portWidthOverrides: { data: 5 },
            interfaceProperties: { dataBitsPerSymbol: 1, symbolsPerBeat: 5 },
          },
        ],
      })
    );

    expect(result.endian_swap_ports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'stream_data',
          width: 5,
          swap_kind: 'lane',
          lane_width: 1,
        }),
      ])
    );
    expect(
      (result.bus_ports as Array<Record<string, unknown>>).find(
        (port) => port.logical_name === 'data'
      )
    ).toEqual(expect.objectContaining({ needs_swap: true, lane_width: 1 }));
  });

  it('derives symbol-sized endian lanes from custom contract metadata', () => {
    const result = busResolver.resolve(
      makeInput(
        {
          busInterfaces: [
            {
              name: 'stream',
              type: 'acme:busif:custom_symbol_stream:1.0',
              mode: 'source',
              physicalPrefix: 'stream_',
              endianness: 'big',
              portWidthOverrides: { payload: 5 },
              interfaceProperties: { dataBitsPerSymbol: 1 },
            },
          ],
        },
        {},
        customSymbolLaneLibrary()
      )
    );

    expect(
      (result.bus_ports as Array<Record<string, unknown>>).find(
        (port) => port.logical_name === 'payload'
      )
    ).toEqual(expect.objectContaining({ needs_swap: true, lane_width: 1 }));
  });

  it('does not gate a parameterized swap on the parameter default width', () => {
    const ports = buildUserPorts(
      normalizeIpCoreData({
        parameters: [{ name: 'DATA_WIDTH', value: 12 }],
        ports: [{ name: 'stream', direction: 'in', width: 'DATA_WIDTH', endianness: 'big' }],
      }),
      ['DATA_WIDTH']
    );
    expect(ports[0].width).toBe(12);
    expect(ports[0].is_parameterized).toBe(true);
    expect(ports[0].needs_swap).toBe(true);
  });
});

describe('busResolver interrupt associations', () => {
  it('preserves explicit bus and clock associations in the template context', () => {
    const result = busResolver.resolve(
      makeInput(
        {
          clocks: [{ name: 'clk_sys' }, { name: 'clk_irq' }],
          busInterfaces: [
            {
              name: 's_axi_control',
              type: 'AXI4L',
              mode: 'slave',
              associatedClock: 'clk_sys',
            },
            {
              name: 's_axi_status',
              type: 'AXI4L',
              mode: 'slave',
              physicalPrefix: 's_status_',
              associatedClock: 'clk_irq',
            },
          ],
          interrupts: [
            {
              name: 'irq',
              associatedBusInterface: 's_axi_status',
              associatedClock: 'clk_sys',
            },
          ],
        },
        AXI4_LITE_DEF
      )
    );

    expect(result.interrupt_ports).toEqual([
      expect.objectContaining({
        name: 'irq',
        associated_bus_interface: 's_axi_status',
        associated_clock: 'clk_sys',
      }),
    ]);
  });

  it('falls back to the primary memory-mapped slave and its associated clock', () => {
    const result = busResolver.resolve(
      makeInput(
        {
          clocks: [{ name: 'clk_sys' }, { name: 'clk_bus' }],
          busInterfaces: [
            {
              name: 's_axis',
              type: 'AXIS',
              mode: 'slave',
              physicalPrefix: 's_axis_',
            },
            {
              name: 's_axi',
              type: 'AXI4L',
              mode: 'slave',
              associatedClock: 'clk_bus',
            },
          ],
          interrupts: [{ name: 'irq' }],
        },
        { ...AXI4_LITE_DEF, ...AXI_STREAM_DEF }
      )
    );

    expect(result.interrupt_ports).toEqual([
      expect.objectContaining({
        associated_bus_interface: 's_axi',
        associated_clock: 'clk_bus',
      }),
    ]);
  });

  it('falls back to the primary clock when the selected bus has no clock', () => {
    const result = busResolver.resolve(
      makeInput(
        {
          clocks: [{ name: 'clk_primary' }, { name: 'clk_other' }],
          busInterfaces: [{ name: 's_axi', type: 'AXI4L', mode: 'slave' }],
          interrupts: [{ name: 'irq' }],
        },
        AXI4_LITE_DEF
      )
    );

    expect(result.interrupt_ports).toEqual([
      expect.objectContaining({
        associated_bus_interface: 's_axi',
        associated_clock: 'clk_primary',
      }),
    ]);
  });

  it('maps a single-instance bus array association to its expanded interface name', () => {
    const result = busResolver.resolve(
      makeInput(
        {
          clocks: [{ name: 'clk' }],
          busInterfaces: [
            {
              name: 's_axi',
              type: 'AXI4L',
              mode: 'slave',
              array: { count: 1, namingPattern: 'S_AXI_{index}' },
            },
          ],
          interrupts: [{ name: 'irq', associatedBusInterface: 's_axi' }],
        },
        AXI4_LITE_DEF
      )
    );

    expect(result.interrupt_ports).toEqual([
      expect.objectContaining({
        associated_bus_interface: 'S_AXI_0',
        associated_clock: 'clk',
      }),
    ]);
  });

  it('keeps the addressable point empty when no memory-mapped slave exists', () => {
    const result = busResolver.resolve(
      makeInput(
        {
          clocks: [{ name: 'clk' }],
          busInterfaces: [{ name: 's_axis', type: 'AXIS', mode: 'slave' }],
          interrupts: [{ name: 'irq' }],
        },
        AXI_STREAM_DEF
      )
    );

    expect(result.interrupt_ports).toEqual([
      expect.objectContaining({
        associated_bus_interface: '',
        associated_clock: 'clk',
      }),
    ]);
  });

  it('keeps an explicitly empty addressable point when a memory-mapped slave exists', () => {
    const result = busResolver.resolve(
      makeInput(
        {
          clocks: [{ name: 'clk' }],
          busInterfaces: [{ name: 's_axi', type: 'AXI4L', mode: 'slave' }],
          interrupts: [{ name: 'irq', associatedBusInterface: '' }],
        },
        AXI4_LITE_DEF
      )
    );

    expect(result.interrupt_ports).toEqual([
      expect.objectContaining({
        associated_bus_interface: '',
        associated_clock: 'clk',
      }),
    ]);
  });

  it('rejects an explicit missing or ineligible bus association', () => {
    expect(() =>
      busResolver.resolve(
        makeInput(
          {
            clocks: [{ name: 'clk' }],
            busInterfaces: [{ name: 'm_axi', type: 'AXI4L', mode: 'master' }],
            interrupts: [{ name: 'irq', associatedBusInterface: 'm_axi' }],
          },
          AXI4_LITE_DEF
        )
      )
    ).toThrow(
      "Interrupt 'irq' references missing or ineligible memory-mapped slave interface 'm_axi'"
    );
  });

  it('rejects an explicit missing clock association', () => {
    expect(() =>
      busResolver.resolve(
        makeInput(
          {
            clocks: [{ name: 'clk' }],
            busInterfaces: [{ name: 's_axi', type: 'AXI4L', mode: 'slave' }],
            interrupts: [{ name: 'irq', associatedClock: 'missing_clk' }],
          },
          AXI4_LITE_DEF
        )
      )
    ).toThrow("Interrupt 'irq' references unknown clock 'missing_clk'");
  });
});
