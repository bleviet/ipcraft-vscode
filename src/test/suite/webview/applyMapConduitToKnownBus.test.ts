import { applyMapConduitToKnownBus } from '../../../webview/ipcore/hooks/useGroupPorts';
import type { IpCore } from '../../../webview/types/ipCore';

function makeIpCore(): IpCore {
  return {
    busInterfaces: [
      {
        name: 'fifo_write',
        type: 'xilinx.com:interface:fifo_write:1.0',
        mode: 'conduit',
        physicalPrefix: null,
        conduitPorts: [
          { name: 'fifo_wr_en', direction: 'out', presence: 'required', width: 1 },
          { name: 'fifo_wr_data', direction: 'out', presence: 'required', width: 8 },
          { name: 'fifo_almost_full', direction: 'in', presence: 'required', width: 1 },
        ],
        associatedClock: 'clk',
        associatedReset: 'reset_n',
      },
    ],
  } as unknown as IpCore;
}

describe('applyMapConduitToKnownBus', () => {
  it('sets mode and portNameOverrides, and clears conduitPorts', () => {
    const ipCore = makeIpCore();
    const result = applyMapConduitToKnownBus(ipCore, 0, {
      mode: 'master',
      portNameOverrides: { WR_EN: 'fifo_wr_en', WR_DATA: 'fifo_wr_data' },
      useOptionalPorts: [],
    });

    expect(result[0].mode).toBe('master');
    expect(result[0].conduitPorts).toBeNull();
    expect((result[0] as unknown as Record<string, unknown>).portNameOverrides).toEqual({
      WR_EN: 'fifo_wr_en',
      WR_DATA: 'fifo_wr_data',
    });
  });

  it('sets useOptionalPorts when present', () => {
    const ipCore = makeIpCore();
    const result = applyMapConduitToKnownBus(ipCore, 0, {
      mode: 'master',
      portNameOverrides: { FULL: 'fifo_almost_full' },
      useOptionalPorts: ['FULL'],
    });

    expect((result[0] as unknown as Record<string, unknown>).useOptionalPorts).toEqual(['FULL']);
  });

  it('omits portNameOverrides/useOptionalPorts entirely when empty, rather than setting them to empty objects/arrays', () => {
    const ipCore = makeIpCore();
    const result = applyMapConduitToKnownBus(ipCore, 0, {
      mode: 'slave',
      portNameOverrides: {},
      useOptionalPorts: [],
    });

    const updated = result[0] as unknown as Record<string, unknown>;
    expect('portNameOverrides' in updated).toBe(false);
    expect('useOptionalPorts' in updated).toBe(false);
  });

  it('preserves untouched fields on the bus interface (name, type, associations)', () => {
    const ipCore = makeIpCore();
    const result = applyMapConduitToKnownBus(ipCore, 0, {
      mode: 'master',
      portNameOverrides: {},
      useOptionalPorts: [],
    });

    expect(result[0].name).toBe('fifo_write');
    expect(result[0].type).toBe('xilinx.com:interface:fifo_write:1.0');
    expect(result[0].associatedClock).toBe('clk');
    expect(result[0].associatedReset).toBe('reset_n');
  });

  it('does not mutate the other bus interfaces in the array', () => {
    const ipCore: IpCore = {
      busInterfaces: [{ name: 'a', type: 'foo', mode: 'conduit' }, ...makeIpCore().busInterfaces!],
    } as unknown as IpCore;

    const result = applyMapConduitToKnownBus(ipCore, 1, {
      mode: 'master',
      portNameOverrides: {},
      useOptionalPorts: [],
    });

    expect(result[0]).toEqual(ipCore.busInterfaces![0]);
    expect(result).toHaveLength(2);
  });

  it('does not mutate the original ipCore object', () => {
    const ipCore = makeIpCore();
    const original = JSON.parse(JSON.stringify(ipCore));

    applyMapConduitToKnownBus(ipCore, 0, {
      mode: 'master',
      portNameOverrides: { WR_EN: 'fifo_wr_en' },
      useOptionalPorts: [],
    });

    expect(ipCore).toEqual(original);
  });

  it('returns the busInterfaces array unchanged when busIndex is out of range', () => {
    const ipCore = makeIpCore();
    const result = applyMapConduitToKnownBus(ipCore, 5, {
      mode: 'master',
      portNameOverrides: {},
      useOptionalPorts: [],
    });

    expect(result).toEqual(ipCore.busInterfaces);
  });

  it('returns an empty array when ipCore has no busInterfaces at all', () => {
    const ipCore = {} as IpCore;
    const result = applyMapConduitToKnownBus(ipCore, 0, {
      mode: 'master',
      portNameOverrides: {},
      useOptionalPorts: [],
    });
    expect(result).toEqual([]);
  });
});
