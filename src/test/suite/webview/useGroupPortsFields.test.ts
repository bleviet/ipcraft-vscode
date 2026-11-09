import { renderHook, act } from '@testing-library/react';
import { useGroupPorts } from '../../../webview/ipcore/hooks/useGroupPorts';
import {
  collectPortFields,
  fieldsProp,
  mergePortFields,
  portFieldsForLogical,
} from '../../../webview/ipcore/utils/portFieldTransfer';
import type { IpCore } from '../../../webview/types/ipCore';

type Mutations = Array<[Array<string | number>, unknown]>;

const STATUS = [{ name: 'state', bits: '[3:0]' }];
const DATA = [{ name: 'low', bits: '[7:0]' }];

function makeIpCore(extra: Record<string, unknown> = {}): IpCore {
  return {
    ports: [
      { name: 's_axis_tdata', direction: 'in', width: 32, fields: DATA },
      { name: 's_axis_tvalid', direction: 'in', width: 1 },
      { name: 'o_status', direction: 'out', width: 8, fields: STATUS },
    ],
    busInterfaces: [],
    ...extra,
  } as unknown as IpCore;
}

function setup(ipCore: IpCore) {
  const calls: Mutations[] = [];
  const hook = renderHook(() => useGroupPorts(ipCore, (m) => calls.push(m)));
  return { calls, gestures: hook.result.current, run: (fn: () => void) => act(fn) };
}

const busesOf = (calls: Mutations[]) => calls[0][1][1] as Array<Record<string, unknown>>;
const portsOf = (calls: Mutations[]) => calls[0][0][1] as Array<Record<string, unknown>>;

describe('portFieldTransfer', () => {
  it('fieldsProp omits empty lists', () => {
    expect(fieldsProp(undefined)).toEqual({});
    expect(fieldsProp([])).toEqual({});
    expect(fieldsProp(STATUS)).toEqual({ fields: STATUS });
  });

  it('collectPortFields drops entries without fields and returns undefined when none remain', () => {
    expect(
      collectPortFields([
        ['A', undefined],
        ['B', []],
      ])
    ).toBeUndefined();
    expect(
      collectPortFields([
        ['A', STATUS],
        ['B', []],
      ])
    ).toEqual({ A: STATUS });
  });

  it('mergePortFields lets incoming keys win', () => {
    expect(mergePortFields({ A: STATUS, B: STATUS }, { A: DATA })).toEqual({ A: DATA, B: STATUS });
    expect(mergePortFields(undefined, undefined)).toBeUndefined();
  });

  it('portFieldsForLogical ignores case', () => {
    expect(portFieldsForLogical({ TDATA: DATA }, 'tdata')).toBe(DATA);
    expect(portFieldsForLogical({ TDATA: DATA }, 'TVALID')).toBeUndefined();
    expect(portFieldsForLogical(undefined, 'TDATA')).toBeUndefined();
  });
});

describe('field metadata follows the signal through grouping gestures', () => {
  const standardOpts = {
    portIndices: [0, 1],
    busType: 'ipcraft:busif:axi_stream:1.0',
    mode: 'slave' as const,
    physicalPrefix: 's_axis_',
    interfaceName: 's_axis',
  };

  it('groupAsStandard writes portFields onto the new bus in one update', () => {
    const { calls, gestures, run } = setup(makeIpCore());
    run(() => gestures.groupAsStandard({ ...standardOpts, portFields: { TDATA: DATA } }));

    expect(calls).toHaveLength(1);
    expect(busesOf(calls)[0].portFields).toEqual({ TDATA: DATA });
    expect(portsOf(calls).map((p) => p.name)).toEqual(['o_status']);
  });

  it('groupAsStandard omits portFields when none are given or the map is empty', () => {
    const { calls, gestures, run } = setup(makeIpCore());
    run(() => gestures.groupAsStandard({ ...standardOpts, portFields: {} }));
    expect('portFields' in busesOf(calls)[0]).toBe(false);
  });

  it('mergePortsIntoStandardBus merges portFields into the existing bus, new keys winning', () => {
    const ipCore = makeIpCore({
      busInterfaces: [
        {
          name: 's_axis',
          type: 'ipcraft:busif:axi_stream:1.0',
          mode: 'slave',
          portFields: { TDATA: STATUS, TLAST: STATUS },
        },
      ],
    });
    const { calls, gestures, run } = setup(ipCore);
    run(() =>
      gestures.mergePortsIntoStandardBus({ ...standardOpts, portFields: { TDATA: DATA } }, 0)
    );

    expect(calls).toHaveLength(1);
    expect(busesOf(calls)[0].portFields).toEqual({ TDATA: DATA, TLAST: STATUS });
  });

  it('mergePortsIntoStandardBus leaves a bus without portFields alone', () => {
    const ipCore = makeIpCore({
      busInterfaces: [{ name: 's_axis', type: 'ipcraft:busif:axi_stream:1.0', mode: 'slave' }],
    });
    const { calls, gestures, run } = setup(ipCore);
    run(() => gestures.mergePortsIntoStandardBus(standardOpts, 0));
    expect('portFields' in busesOf(calls)[0]).toBe(false);
  });

  it('addPortToStandardBus moves port.fields to portFields[signalName]', () => {
    const ipCore = makeIpCore({
      busInterfaces: [
        {
          name: 's_axis',
          type: 'ipcraft:busif:axi_stream:1.0',
          mode: 'slave',
          physicalPrefix: 's_axis_',
          portFields: { TLAST: STATUS },
        },
      ],
    });
    const { calls, gestures, run } = setup(ipCore);
    run(() => gestures.addPortToStandardBus(0, 0, 'TDATA'));

    expect(calls).toHaveLength(1);
    expect(busesOf(calls)[0].portFields).toEqual({ TLAST: STATUS, TDATA: DATA });
  });

  it('addPortToStandardBus adds no portFields for a port without fields', () => {
    const ipCore = makeIpCore({
      busInterfaces: [{ name: 's_axis', type: 'ipcraft:busif:axi_stream:1.0', mode: 'slave' }],
    });
    const { calls, gestures, run } = setup(ipCore);
    run(() => gestures.addPortToStandardBus(1, 0, 'TVALID'));
    expect('portFields' in busesOf(calls)[0]).toBe(false);
  });

  it('groupAsConduit copies port.fields onto the conduit ports', () => {
    const { calls, gestures, run } = setup(makeIpCore());
    run(() =>
      gestures.groupAsConduit({ portIndices: [0, 1], interfaceName: 'c', physicalPrefix: '' })
    );

    expect(busesOf(calls)[0].conduitPorts).toEqual([
      { name: 's_axis_tdata', direction: 'in', width: 32, fields: DATA },
      { name: 's_axis_tvalid', direction: 'in', width: 1 },
    ]);
  });

  it('addPortToConduit copies port.fields onto the new conduit port', () => {
    const ipCore = makeIpCore({
      busInterfaces: [
        { name: 'c', type: 'ipcraft:busif:conduit:1.0', mode: 'conduit', conduitPorts: [] },
      ],
    });
    const { calls, gestures, run } = setup(ipCore);
    run(() => gestures.addPortToConduit(2, 0));

    expect(calls).toHaveLength(1);
    expect(busesOf(calls)[0].conduitPorts).toEqual([
      { name: 'o_status', direction: 'out', width: 8, fields: STATUS },
    ]);
  });
});
