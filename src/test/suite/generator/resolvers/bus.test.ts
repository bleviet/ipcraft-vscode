import { busResolver, buildUserPorts } from '../../../../generator/resolvers/bus';
import { normalizeIpCoreData } from '../../../../generator/registerProcessor';
import { BUS_REGISTRY } from '../../../../generator/buses/builtin';
import type { ResolverInput } from '../../../../generator/resolvers/types';
import type { BusDefinitions } from '../../../../generator/types';

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

function makeInput(
  raw: Record<string, unknown>,
  busDefinitions: BusDefinitions = {}
): ResolverInput {
  return {
    ipCore: normalizeIpCoreData(raw),
    registers: [],
    busDefinitions,
    registry: BUS_REGISTRY,
  };
}

describe('busResolver endianness', () => {
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
      s_axi_wdata: 'byte',
      s_axi_rdata: 'byte',
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
    }>;
    const byName = Object.fromEntries(swapPorts.map((p) => [p.name, p]));
    // Parameterized data ports byte-swap via a width-generic generate loop, so they
    // contribute no fixed-width swap_bytes_<N>() helper.
    expect(byName['s_axi_wdata'].is_parameterized).toBe(true);
    expect(byName['s_axi_rdata'].is_parameterized).toBe(true);
    expect(byName['s_axi_wdata'].swap_kind).toBe('byte');
    // WSTRB (byteQualifier) is a fixed 4-bit mask, reversed as bits — never a swap_bytes helper.
    expect(byName['s_axi_wstrb'].swap_kind).toBe('bit');
    expect(result.endian_swap_widths).toEqual([]);
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
    expect(ports[0].swap_kind).toBe('byte');
  });
});
