import type { IpCore } from '../../../domain/ipcore.types';
import { copyPortLayouts } from '../../../dataInspector/portLayouts';
import { builtinBusLibrary } from '../../helpers/busLibrary';

const core = (partial: Record<string, unknown>): IpCore => partial as unknown as IpCore;
const port = (extra: Record<string, unknown>) => ({ name: 'o_status', direction: 'out', ...extra });
const copy = (partial: Record<string, unknown>, withLibrary = false) =>
  copyPortLayouts('cores/s.ip.yml', core(partial), withLibrary ? builtinBusLibrary() : undefined);

describe('copyPortLayouts', () => {
  it('copies a top-level port with bits, offset/width and enum fields', () => {
    const layouts = copy({
      ports: [
        port({
          width: 12,
          fields: [
            {
              name: 'state',
              bits: '[3:0]',
              description: 'FSM',
              enumeratedValues: { '0': 'IDLE', '0xF': 'ERR' },
            },
            { name: 'mode', offset: 4, width: 2 },
          ],
        }),
      ],
    });

    expect(layouts).toHaveLength(1);
    expect(layouts[0]).toMatchObject({
      id: 'cores/s.ip.yml:port:o_status',
      label: 's.ip.yml · o_status',
      kind: 'port',
      width: 12,
      sourceFile: 'cores/s.ip.yml',
      provenance: { sourceFile: 'cores/s.ip.yml', portName: 'o_status' },
    });
    expect(layouts[0].provenance).not.toHaveProperty('busInterface');
    expect(layouts[0].fields).toEqual([
      {
        id: 'import-0-state',
        name: 'state',
        msb: 3,
        lsb: 0,
        groupId: 'default',
        description: 'FSM',
        enumValues: { '0': 'IDLE', '0xF': 'ERR' },
      },
      {
        id: 'import-1-mode',
        name: 'mode',
        msb: 5,
        lsb: 4,
        groupId: 'default',
        description: undefined,
        enumValues: undefined,
      },
    ]);
  });

  it('resolves a parametric width from the parameter default', () => {
    const layouts = copy({
      parameters: [{ name: 'W', value: 16 }],
      ports: [port({ width: 'W', fields: [{ name: 'a', bits: '[15:8]' }] })],
    });
    expect(layouts[0].width).toBe(16);
  });

  it('skips ports whose width does not resolve or exceeds 4096', () => {
    expect(
      copy({ ports: [port({ width: 'MISSING', fields: [{ name: 'a', bits: '[0]' }] })] })
    ).toEqual([]);
    expect(copy({ ports: [port({ width: 4097, fields: [{ name: 'a', bits: '[0]' }] })] })).toEqual(
      []
    );
    expect(
      copy({ ports: [port({ width: 4096, fields: [{ name: 'a', bits: '[0]' }] })] })
    ).toHaveLength(1);
  });

  it('skips malformed and out-of-range fields but keeps the rest', () => {
    const layouts = copy({
      ports: [
        port({
          width: 4,
          fields: [
            { name: 'bad', bits: 'nope' },
            { name: 'wide', bits: '[7:0]' },
            { name: 'ok', bits: '[1:0]' },
          ],
        }),
      ],
    });
    expect(layouts[0].fields.map((f) => [f.id, f.name])).toEqual([['import-2-ok', 'ok']]);
  });

  it('skips a field that overlaps an earlier usable field', () => {
    const layouts = copy({
      ports: [
        port({
          width: 8,
          fields: [
            { name: 'a', bits: '[3:0]' },
            { name: 'b', bits: '[4:3]' },
            { name: 'c', bits: '[5:4]' },
          ],
        }),
      ],
    });
    expect(layouts[0].fields.map((f) => f.name)).toEqual(['a', 'c']);
  });

  it('keeps ids unique across a port, conduit port and bus port of the same name', () => {
    const layouts = copy(
      {
        ports: [port({ name: 'tdata', width: 8, fields: [{ name: 'a', bits: '[0]' }] })],
        busInterfaces: [
          {
            name: 's_axis',
            type: 'ipcraft:busif:axi_stream:1.0',
            mode: 'slave',
            conduitPorts: [{ name: 'TDATA', width: 8, fields: [{ name: 'b', bits: '[0]' }] }],
            portFields: { TDATA: [{ name: 'c', bits: '[0]' }] },
          },
        ],
      },
      true
    );
    const ids = layouts.map((l) => l.id);
    expect(ids).toEqual([
      'cores/s.ip.yml:port:tdata',
      'cores/s.ip.yml:conduit:s_axis/TDATA',
      'cores/s.ip.yml:bus:s_axis/TDATA',
    ]);
  });

  it('offers no layout for a port without usable fields', () => {
    expect(copy({ ports: [port({ width: 4 })] })).toEqual([]);
    expect(
      copy({ ports: [port({ width: 4, fields: [{ name: 'wide', bits: '[9:8]' }] })] })
    ).toEqual([]);
  });

  it('copies a conduit port with its bus interface in the provenance', () => {
    const layouts = copy({
      busInterfaces: [
        {
          name: 'dbg',
          type: 'conduit',
          mode: 'master',
          conduitPorts: [{ name: 'trace', width: 8, fields: [{ name: 'a', bits: '[3:0]' }] }],
        },
      ],
    });
    expect(layouts[0]).toMatchObject({
      id: 'cores/s.ip.yml:conduit:dbg/trace',
      label: 's.ip.yml · dbg/trace (conduit)',
      provenance: { sourceFile: 'cores/s.ip.yml', busInterface: 'dbg', portName: 'trace' },
    });
  });

  describe('bus ports', () => {
    const bus = (portFields: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
      busInterfaces: [
        {
          name: 's_axis',
          type: 'ipcraft:busif:axi_stream:1.0',
          mode: 'slave',
          portFields,
          ...extra,
        },
      ],
    });

    it('uses contract casing for a lowercase authored key', () => {
      const layouts = copy(bus({ tdata: [{ name: 'low', bits: '[7:0]' }] }), true);
      expect(layouts).toHaveLength(1);
      expect(layouts[0]).toMatchObject({
        id: 'cores/s.ip.yml:bus:s_axis/TDATA',
        label: 's.ip.yml · s_axis/TDATA',
        width: 32,
        provenance: { sourceFile: 'cores/s.ip.yml', busInterface: 's_axis', portName: 'TDATA' },
      });
    });

    it('skips unknown and inactive keys', () => {
      const layouts = copy(
        bus(
          {
            TNOPE: [{ name: 'a', bits: '[0]' }],
            TKEEP: [{ name: 'b', bits: '[0]' }],
            TDATA: [{ name: 'c', bits: '[0]' }],
          },
          { absentPorts: ['TKEEP'] }
        ),
        true
      );
      expect(layouts.map((l) => l.provenance)).toEqual([
        expect.objectContaining({ portName: 'TDATA' }),
      ]);
    });

    it('keeps the first of two keys that name the same contract port', () => {
      const layouts = copy(
        bus({
          tdata: [{ name: 'first', bits: '[0]' }],
          TDATA: [{ name: 'second', bits: '[1]' }],
        }),
        true
      );
      expect(layouts).toHaveLength(1);
      expect(layouts[0].fields.map((f) => f.name)).toEqual(['first']);
    });

    it('takes the width from rawPortMaps when no contract matches', () => {
      const layouts = copy(
        bus(
          { Data: [{ name: 'low', bits: '[7:0]' }] },
          { type: 'vendor:custom:bus:1.0', rawPortMaps: [{ logical: 'DATA', width: 16 }] }
        ),
        true
      );
      expect(layouts).toHaveLength(1);
      expect(layouts[0]).toMatchObject({
        width: 16,
        provenance: { busInterface: 's_axis', portName: 'DATA' },
      });
    });

    it('skips a contract key whose width does not resolve', () => {
      const layouts = copy(
        bus(
          { TDATA: [{ name: 'low', bits: '[7:0]' }] },
          { portWidthOverrides: { TDATA: 'MISSING' } }
        ),
        true
      );
      expect(layouts).toEqual([]);
    });

    it('skips bus ports without a library', () => {
      expect(copy(bus({ TDATA: [{ name: 'low', bits: '[7:0]' }] }))).toEqual([]);
    });
  });
});
