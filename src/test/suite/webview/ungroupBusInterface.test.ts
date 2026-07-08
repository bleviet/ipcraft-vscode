import { renderHook, act } from '@testing-library/react';
import { useGroupPorts } from '../../../webview/ipcore/hooks/useGroupPorts';
import type { IpCore } from '../../../webview/types/ipCore';
import type { BusPortDef } from '../../../webview/ipcore/data/busDefinitions';

function makeStandardBusIpCore(): IpCore {
  return {
    ports: [],
    busInterfaces: [
      {
        name: 's_axi',
        type: 'xilinx.com:interface:aximm:2.0',
        mode: 'slave',
        physicalPrefix: 's_axi_',
        portNameOverrides: { AWADDR: 'awaddr', WDATA: 'wdata' },
        portWidthOverrides: { AWADDR: 16, WDATA: 64 },
        useOptionalPorts: [],
      },
    ],
  } as unknown as IpCore;
}

/**
 * A minimal library bus definition for the xilinx.com:interface:aximm:2.0 type
 * with only the signals needed to verify port reconstruction.
 */
const LIBRARY_BUS_DEFS: BusPortDef[] = [
  { name: 'AWADDR', width: 32, direction: 'out', presence: 'required' },
  { name: 'WDATA', width: 32, direction: 'out', presence: 'required' },
  { name: 'BRESP', width: 2, direction: 'in', presence: 'required' },
];

function makeBusDefs(type: string): BusPortDef[] | null {
  if (type === 'xilinx.com:interface:aximm:2.0') {
    return LIBRARY_BUS_DEFS;
  }
  return null;
}

describe('ungroupBusInterface', () => {
  it('restores ports for library bus type using the busDefs resolver', () => {
    const ipCore = makeStandardBusIpCore();
    const mutations: Array<[Array<string | number>, unknown]>[] = [];
    const batchUpdate = (m: Array<[Array<string | number>, unknown]>) => mutations.push(m);

    const { result } = renderHook(() => useGroupPorts(ipCore, batchUpdate, makeBusDefs));

    act(() => {
      result.current.ungroupBusInterface(0);
    });

    expect(mutations).toHaveLength(1);
    const [portsMutation, busesMutation] = mutations[0];

    expect(portsMutation[0]).toEqual(['ports']);
    const restoredPorts = portsMutation[1] as Array<{
      name: string;
      direction: string;
      width?: number | string;
    }>;
    expect(restoredPorts).toHaveLength(3);

    // AWADDR should use portNameOverride ('awaddr') and portWidthOverride (16)
    const awaddr = restoredPorts.find((p) => p.name === 's_axi_awaddr');
    expect(awaddr).toBeDefined();
    expect(awaddr?.width).toBe(16);

    // WDATA should use portNameOverride ('wdata') and portWidthOverride (64)
    const wdata = restoredPorts.find((p) => p.name === 's_axi_wdata');
    expect(wdata).toBeDefined();
    expect(wdata?.width).toBe(64);

    // BRESP should use definition default width (2)
    const bresp = restoredPorts.find((p) => p.name === 's_axi_bresp');
    expect(bresp).toBeDefined();
    expect(bresp?.width).toBe(2);

    // Directions for slave mode: in=out and out=in relative to master definition
    expect(awaddr?.direction).toBe('in');
    expect(wdata?.direction).toBe('in');
    expect(bresp?.direction).toBe('out');

    expect(busesMutation[0]).toEqual(['busInterfaces']);
    expect(busesMutation[1]).toBeUndefined();
  });

  it('restores no ports when busDefs returns null for an unknown library type', () => {
    const ipCore = makeStandardBusIpCore();
    const mutations: Array<[Array<string | number>, unknown]>[] = [];
    const batchUpdate = (m: Array<[Array<string | number>, unknown]>) => mutations.push(m);

    // Pass a resolver that knows nothing about the bus type
    const { result } = renderHook(() => useGroupPorts(ipCore, batchUpdate, () => null));

    act(() => {
      result.current.ungroupBusInterface(0);
    });

    expect(mutations).toHaveLength(1);
    const [portsMutation] = mutations[0];
    // No ports can be restored — result should be an empty ports array
    expect((portsMutation[1] as unknown[]).length).toBe(0);
  });
});
