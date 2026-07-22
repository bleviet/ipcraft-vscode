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

  it('marks the data ports (not control ports) for swap on a big-endian interface', () => {
    const result = busResolver.resolve(
      makeInput(
        {
          busInterfaces: [{ name: 's_axi', type: 'AXI4L', mode: 'slave', endianness: 'big' }],
        },
        AXI4_LITE_DEF
      )
    );
    expect(result.has_endian_swap).toBe(true);
    const swapNames = (result.endian_swap_ports as Array<{ name: string }>).map((p) => p.name);
    expect(swapNames.sort()).toEqual(['s_axi_rdata', 's_axi_wdata']);
    expect(result.endian_swap_widths).toEqual([32]);

    const busPorts = result.bus_ports as Array<{
      logical_name: string;
      needs_swap?: boolean;
    }>;
    const wvalid = busPorts.find((p) => p.logical_name === 'WVALID');
    expect(wvalid?.needs_swap).toBeFalsy();
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
});
