import type { BusDefinitionContract } from '../../../shared/busContracts';
import { dataLaneKind } from '../../../shared/busContracts';

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
