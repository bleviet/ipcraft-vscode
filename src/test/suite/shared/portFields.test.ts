import type { IpCore } from '../../../domain/ipcore.types';
import { enumeratePortFieldLists, portFieldRange } from '../../../shared/portFields';
import { builtinBusLibrary } from '../../helpers/busLibrary';

const core = (partial: Record<string, unknown>): IpCore => partial as unknown as IpCore;

describe('portFieldRange', () => {
  it('reads bits in either order and offset/width', () => {
    expect(portFieldRange({ name: 'a', bits: '[3:0]' })).toEqual({ msb: 3, lsb: 0 });
    expect(portFieldRange({ name: 'a', bits: '[0:3]' })).toEqual({ msb: 3, lsb: 0 });
    expect(portFieldRange({ name: 'a', offset: 4, width: 2 })).toEqual({ msb: 5, lsb: 4 });
  });

  it('explains malformed positions', () => {
    expect(portFieldRange({ name: 'a', bits: '[1:0]', offset: 0, width: 2 })).toMatch(/not both/);
    expect(portFieldRange({ name: 'a', bits: 'nope' })).toMatch(/not a valid range/);
    expect(portFieldRange({ name: 'a', offset: 0, width: 0 })).toMatch(/positive integer/);
    expect(portFieldRange({ name: 'a' })).toBe('use bits or offset/width');
  });
});

describe('enumeratePortFieldLists', () => {
  const ipCore = core({
    parameters: [{ name: 'W', value: 8 }],
    ports: [
      { name: 'o_a', direction: 'out', width: 'W', fields: [{ name: 'x', bits: '[0]' }] },
      { name: 'o_none', direction: 'out', width: 4 },
    ],
    busInterfaces: [
      {
        name: 's_axis',
        type: 'ipcraft:busif:axi_stream:1.0',
        mode: 'slave',
        conduitPorts: [{ name: 'c', width: 3, fields: [{ name: 'y', bits: '[1:0]' }] }],
        portFields: {
          tdata: [{ name: 'low', bits: '[7:0]' }],
          TNOPE: [{ name: 'z', bits: '[0]' }],
        },
      },
    ],
  });

  it('lists ports, conduit ports and bus keys with resolved widths', () => {
    const lists = enumeratePortFieldLists(ipCore, builtinBusLibrary());

    expect(lists.map((l) => [l.kind, l.portName, l.busInterface, l.width])).toEqual([
      ['port', 'o_a', undefined, 8],
      ['conduit', 'c', 's_axis', 3],
      ['bus', 'tdata', 's_axis', 32],
      ['bus', 'TNOPE', 's_axis', undefined],
    ]);
    expect(lists[0].path).toEqual(['ports', 0, 'fields']);
    expect(lists[2]).toMatchObject({ canonicalPortName: 'TDATA' });
    expect(lists[3]).toMatchObject({ keyProblem: 'unknown' });
  });

  it('omits bus keys without a library', () => {
    expect(enumeratePortFieldLists(ipCore, undefined).map((l) => l.kind)).toEqual([
      'port',
      'conduit',
    ]);
  });
});
