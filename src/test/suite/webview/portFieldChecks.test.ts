import { checkPortFields } from '../../../webview/ipcore/utils/portFieldChecks';
import { elementIdsForIssue } from '../../../webview/ipcore/types/issues';
import type { IpCore } from '../../../webview/types/ipCore';
import { builtinBusLibrary } from '../../helpers/busLibrary';

function core(partial: Record<string, unknown>): IpCore {
  return partial as unknown as IpCore;
}

function codes(ipCore: IpCore, withLibrary = false): string[] {
  return checkPortFields(ipCore, withLibrary ? builtinBusLibrary() : undefined).map(
    (issue) => issue.code
  );
}

const statusPort = (fields: unknown[], width: number | string = 12) => ({
  name: 'o_status',
  direction: 'out',
  width,
  fields,
});

describe('checkPortFields', () => {
  it('reports nothing for a valid file', () => {
    const ipCore = core({
      ports: [
        statusPort([
          { name: 'state', bits: '[3:0]', enumeratedValues: { '0': 'idle', '0xF': 'error' } },
          { name: 'mode', offset: 4, width: 2 },
        ]),
      ],
      busInterfaces: [
        {
          name: 's_axis',
          type: 'ipcraft:busif:axi_stream:1.0',
          mode: 'slave',
          portFields: { TDATA: [{ name: 'low', bits: '[7:0]' }] },
        },
      ],
    });
    expect(checkPortFields(ipCore, builtinBusLibrary())).toEqual([]);
  });

  it('marks every issue as a portFields warning with a path to the field', () => {
    const issues = checkPortFields(
      core({ ports: [statusPort([{ name: 'a', bits: '[1:0]', offset: 0, width: 2 }])] }),
      undefined
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'PORT_FIELD_POSITION',
        severity: 'warning',
        source: 'portFields',
        path: ['ports', 0, 'fields', 0],
        message: 'o_status.a: use bits or offset/width, not both',
      }),
    ]);
  });

  it.each([
    ['neither form', { name: 'a' }],
    ['bits not parseable', { name: 'a', bits: 'high' }],
    ['offset without width', { name: 'a', offset: 1 }],
    ['negative offset', { name: 'a', offset: -1, width: 2 }],
  ])('flags a bad position: %s', (_label, field) => {
    expect(codes(core({ ports: [statusPort([field])] }))).toEqual(['PORT_FIELD_POSITION']);
  });

  it('flags a field beyond the port width', () => {
    const issues = checkPortFields(
      core({ ports: [statusPort([{ name: 'level', bits: '[15:8]' }])] }),
      undefined
    );
    expect(issues.map((i) => [i.code, i.message])).toEqual([
      ['PORT_FIELD_RANGE', 'o_status.level [15:8] exceeds port width 12'],
    ]);
  });

  it('resolves a parametric width from the parameter default', () => {
    const ipCore = core({
      parameters: [{ name: 'W', value: 4 }],
      ports: [statusPort([{ name: 'hi', bits: '[7:4]' }], 'W')],
    });
    expect(codes(ipCore)).toEqual(['PORT_FIELD_RANGE']);
  });

  it('skips the range check when the width does not resolve', () => {
    const ipCore = core({ ports: [statusPort([{ name: 'hi', bits: '[70:4]' }], 'UNKNOWN_W')] });
    expect(codes(ipCore)).toEqual([]);
  });

  it('flags overlapping fields at the lowest shared bit', () => {
    const issues = checkPortFields(
      core({
        ports: [
          statusPort([
            { name: 'state', bits: '[3:0]' },
            { name: 'mode', bits: '[5:3]' },
          ]),
        ],
      }),
      undefined
    );
    expect(issues.map((i) => [i.code, i.message, i.path])).toEqual([
      [
        'PORT_FIELD_OVERLAP',
        'o_status: fields state and mode overlap at bit 3',
        ['ports', 0, 'fields', 1],
      ],
    ]);
  });

  it('flags duplicate field names', () => {
    const issues = checkPortFields(
      core({
        ports: [
          statusPort([
            { name: 'state', bits: '[1:0]' },
            { name: 'state', bits: '[3:2]' },
          ]),
        ],
      }),
      undefined
    );
    expect(issues.map((i) => [i.code, i.message])).toEqual([
      ['PORT_FIELD_DUPLICATE_NAME', 'o_status: duplicate field name state'],
    ]);
  });

  it('flags enumerated values that are not integers or do not fit', () => {
    const issues = checkPortFields(
      core({
        ports: [
          statusPort([
            {
              name: 'state',
              bits: '[3:0]',
              enumeratedValues: {
                '17': 'big',
                '0x10': 'big_hex',
                '-1': 'neg',
                idle: 'x',
                '15': 'ok',
              },
            },
          ]),
        ],
      }),
      undefined
    );
    expect(issues.map((i) => i.message).sort()).toEqual([
      "o_status.state: value '-1' is not a non-negative integer",
      "o_status.state: value 'idle' is not a non-negative integer",
      'o_status.state: value 0x10 does not fit in 4 bits',
      'o_status.state: value 17 does not fit in 4 bits',
    ]);
    expect(new Set(issues.map((i) => JSON.stringify(i.path))).size).toBe(4);
  });

  it('compares enumerated values wider than 53 bits exactly', () => {
    const wide = (key: string) =>
      core({
        ports: [statusPort([{ name: 'f', bits: '[59:0]', enumeratedValues: { [key]: 'v' } }], 64)],
      });
    expect(codes(wide('0xFFFFFFFFFFFFFFF'))).toEqual([]);
    expect(codes(wide('0x1000000000000000'))).toEqual(['PORT_FIELD_ENUM_VALUE']);
  });

  it('checks conduit port fields and sets the interface name', () => {
    const issues = checkPortFields(
      core({
        busInterfaces: [
          {
            name: 'dbg',
            type: 'ipcraft:busif:conduit:1.0',
            mode: 'conduit',
            conduitPorts: [
              {
                name: 'dbg_val',
                direction: 'out',
                width: 4,
                fields: [{ name: 'x', bits: '[7:0]' }],
              },
            ],
          },
        ],
      }),
      undefined
    );
    expect(issues).toEqual([
      expect.objectContaining({
        code: 'PORT_FIELD_RANGE',
        path: ['busInterfaces', 0, 'conduitPorts', 0, 'fields', 0],
        interfaceName: 'dbg',
      }),
    ]);
  });

  describe('bus portFields', () => {
    const axis = (portFields: Record<string, unknown[]>, extra: Record<string, unknown> = {}) =>
      core({
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

    it('uses the contract width for range checks and matches names case-insensitively', () => {
      const issues = checkPortFields(
        axis({ tdata: [{ name: 'hi', bits: '[39:32]' }] }),
        builtinBusLibrary()
      );
      expect(issues).toEqual([
        expect.objectContaining({
          code: 'PORT_FIELD_RANGE',
          path: ['busInterfaces', 0, 'portFields', 'tdata', 0],
          interfaceName: 's_axis',
          message: 'tdata.hi [39:32] exceeds port width 32',
        }),
      ]);
    });

    it('flags a key that is not a port of the bus definition', () => {
      const issues = checkPortFields(axis({ TKEEP2: [] }), builtinBusLibrary());
      expect(issues).toEqual([
        expect.objectContaining({
          code: 'PORT_FIELDS_UNKNOWN_PORT',
          path: ['busInterfaces', 0, 'portFields', 'TKEEP2'],
          message: expect.stringContaining('s_axis.portFields: TKEEP2 is not a port of'),
        }),
      ]);
    });

    it('flags a key for an optional port that is not enabled, and accepts it once enabled', () => {
      const fields = { TKEEP: [{ name: 'lane0', bits: '[0]' }] };
      expect(codes(axis(fields), true)).toEqual(['PORT_FIELDS_INACTIVE_PORT']);
      expect(codes(axis(fields, { useOptionalPorts: ['TKEEP'] }), true)).toEqual([]);
    });

    it('flags an absent required port as inactive', () => {
      expect(codes(axis({ TDATA: [] }, { absentPorts: ['TDATA'] }), true)).toEqual([
        'PORT_FIELDS_INACTIVE_PORT',
      ]);
    });

    it('skips bus portFields when no library is available', () => {
      expect(codes(axis({ NOPE: [{ name: 'a', bits: '[99:0]' }] }), false)).toEqual([]);
    });

    it('skips key checks when the bus type does not resolve and there are no rawPortMaps', () => {
      const ipCore = core({
        busInterfaces: [
          {
            name: 'x',
            type: 'acme:lib:unknown:1.0',
            mode: 'slave',
            portFields: { WHATEVER: [{ name: 'a', bits: '[3:0]' }] },
          },
        ],
      });
      expect(codes(ipCore, true)).toEqual([]);
    });

    it('uses rawPortMaps for an interface without a contract', () => {
      const ipCore = core({
        busInterfaces: [
          {
            name: 'x',
            type: 'acme:lib:unknown:1.0',
            mode: 'slave',
            rawPortMaps: [{ logical: 'DATA', physical: 'x_data', direction: 'in', width: 8 }],
            portFields: {
              data: [{ name: 'hi', bits: '[11:8]' }],
              OTHER: [{ name: 'a', bits: '[0]' }],
            },
          },
        ],
      });
      expect(checkPortFields(ipCore, builtinBusLibrary()).map((i) => [i.code, i.path[3]])).toEqual([
        ['PORT_FIELD_RANGE', 'data'],
        ['PORT_FIELDS_UNKNOWN_PORT', 'OTHER'],
      ]);
    });
  });
});

describe('elementIdsForIssue for portFields paths', () => {
  it('selects the logical sub-port of a bus portFields issue', () => {
    const [issue] = checkPortFields(
      core({
        busInterfaces: [
          {
            name: 's_axis',
            type: 'ipcraft:busif:axi_stream:1.0',
            mode: 'slave',
            portFields: { TKEEP: [] },
          },
        ],
      }),
      builtinBusLibrary()
    );
    expect(elementIdsForIssue(issue)).toEqual(['bus:0', 'bus:0:TKEEP']);
  });

  it('selects the port for a top-level port field issue', () => {
    const [issue] = checkPortFields(core({ ports: [statusPort([{ name: 'a' }])] }), undefined);
    expect(elementIdsForIssue(issue)).toEqual(['port:0']);
  });
});
