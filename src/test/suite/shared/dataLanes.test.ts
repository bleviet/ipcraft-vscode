import type { BusDefinitionContract } from '../../../shared/busContracts';
import { builtinBusLibrary } from '../../helpers/busLibrary';
import { dataLaneKind, resolveBusInterface, resolveDataLane } from '../../../shared/busContracts';

function contract(interfaceProperties: BusDefinitionContract['interfaceProperties']) {
  return { interfaceProperties } as BusDefinitionContract;
}

describe('dataLaneKind', () => {
  it('uses symbol lanes only when the contract declares symbol width metadata', () => {
    expect(dataLaneKind(contract({}))).toBe('byte');
    expect(
      dataLaneKind(
        contract({
          dataBitsPerSymbol: { type: 'integer', minimum: 1 },
        })
      )
    ).toBe('symbol');
  });
});

describe('resolveDataLane', () => {
  const library = builtinBusLibrary();
  const lane = (dataBitsPerSymbol: number | string | undefined, parameterValue = 8) => {
    const busInterface = {
      name: 'stream',
      type: 'ipcraft:busif:avalon_st:1.0',
      mode: 'source',
      ...(dataBitsPerSymbol === undefined ? {} : { interfaceProperties: { dataBitsPerSymbol } }),
    };
    const resolution = resolveBusInterface({
      busInterface,
      busIndex: 0,
      parameters: [{ name: 'SYMBOL_W', value: parameterValue }] as never,
      library,
    });
    return resolveDataLane(resolution, busInterface);
  };

  it('keeps a parameter-valued lane symbolic', () => {
    expect(lane('SYMBOL_W')).toEqual({ kind: 'symbol', width: 'SYMBOL_W' });
    expect(lane('SYMBOL_W * 2')).toEqual({ kind: 'symbol', width: '(SYMBOL_W*2)' });
  });

  it('keeps a function-valued lane numeric because HDL has no portable clog2', () => {
    expect(lane('clog2(SYMBOL_W)', 16)).toEqual({ kind: 'symbol', width: 4 });
  });

  it('keeps numeric and default lanes numeric', () => {
    expect(lane(4)).toEqual({ kind: 'symbol', width: 4 });
    expect(lane(undefined)).toEqual({ kind: 'symbol', width: 8 });
  });
});
