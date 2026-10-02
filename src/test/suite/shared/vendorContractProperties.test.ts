import type { BusDefinitionContract } from '../../../shared/busContracts';
import { importVendorContractMetadata, isDeclarativeContract } from '../../../shared/busContracts';

const contract: Pick<BusDefinitionContract, 'interfaceProperties'> = {
  interfaceProperties: {
    dataBitsPerSymbol: { type: 'integer', minimum: 1 },
    symbolsPerBeat: { type: 'integer', minimum: 1 },
    readyLatency: { type: 'integer', minimum: 0 },
  },
};

describe('importVendorContractMetadata', () => {
  it('normalizes symbol aliases, derives symbols per beat, and maps ordering', () => {
    expect(
      importVendorContractMetadata({
        contract,
        rawProperties: new Map([
          ['bitsPerSymbol', '1'],
          ['readyLatency', '0'],
          ['firstSymbolInHighOrderBits', 'true'],
        ]),
        dataWidth: 5,
        location: 'fixture interface stream',
      })
    ).toEqual({
      interfaceProperties: {
        dataBitsPerSymbol: 1,
        symbolsPerBeat: 5,
        readyLatency: 0,
      },
      endianness: 'big',
    });
  });

  it('rejects conflicting current and legacy symbol-width spellings', () => {
    expect(() =>
      importVendorContractMetadata({
        contract,
        rawProperties: new Map([
          ['dataBitsPerSymbol', '8'],
          ['bitsPerSymbol', '1'],
        ]),
        location: 'fixture interface stream',
      })
    ).toThrow('fixture interface stream declares conflicting dataBitsPerSymbol');
  });

  it.each([
    ['08', '8', 8],
    ['0x8', '8', 8],
    ['1.0', '1', 1],
  ])('accepts equivalent current %s and legacy %s symbol widths', (current, legacy, expected) => {
    expect(
      importVendorContractMetadata({
        contract,
        rawProperties: new Map([
          ['dataBitsPerSymbol', current],
          ['bitsPerSymbol', legacy],
        ]),
        location: 'fixture interface stream',
      }).interfaceProperties?.dataBitsPerSymbol
    ).toBe(expected);
  });

  it.each(['yes', '2', 'enabled'])('rejects malformed boolean vendor value %s', (raw) => {
    expect(() =>
      importVendorContractMetadata({
        contract,
        rawProperties: new Map([['firstSymbolInHighOrderBits', raw]]),
        location: 'fixture interface stream',
      })
    ).toThrow(
      `fixture interface stream.parameters.firstSymbolInHighOrderBits has invalid boolean value '${raw}'`
    );
  });

  it.each(['', '1.5', 'NaN'])('rejects malformed integer vendor value %s', (raw) => {
    expect(() =>
      importVendorContractMetadata({
        contract,
        rawProperties: new Map([['readyLatency', raw]]),
        location: 'fixture interface stream',
      })
    ).toThrow(
      `fixture interface stream.parameters.readyLatency has invalid integer value '${raw}'`
    );
  });

  it('imports nothing when standard properties and a mirror are absent', () => {
    expect(
      importVendorContractMetadata({
        contract,
        rawProperties: new Map(),
        location: 'component.xml busInterfaces.stream',
      })
    ).toEqual({});
  });

  it('imports standard properties when no supported mirror exists', () => {
    expect(
      importVendorContractMetadata({
        contract,
        rawProperties: new Map([['symbolsPerBeat', '5']]),
        location: 'component.xml busInterfaces.stream',
      })
    ).toEqual({ interfaceProperties: { symbolsPerBeat: 5 } });
  });

  it('discards standard resolved values when the supported mirror is empty', () => {
    expect(
      importVendorContractMetadata({
        contract,
        rawProperties: new Map([
          ['dataBitsPerSymbol', '1'],
          ['symbolsPerBeat', '5'],
          ['firstSymbolInHighOrderBits', 'true'],
        ]),
        mirroredProperties: new Map(),
        location: 'component.xml busInterfaces.stream',
      })
    ).toEqual({});
  });

  it('imports only mirrored keys while validating standard resolved values', () => {
    expect(
      importVendorContractMetadata({
        contract,
        rawProperties: new Map([
          ['dataBitsPerSymbol', '1'],
          ['symbolsPerBeat', '5'],
          ['firstSymbolInHighOrderBits', 'true'],
        ]),
        mirroredProperties: new Map([['dataBitsPerSymbol', '1']]),
        location: 'component.xml busInterfaces.stream',
      })
    ).toEqual({ interfaceProperties: { dataBitsPerSymbol: 1 } });
  });

  it('imports a mirrored property when the standard value is absent', () => {
    expect(
      importVendorContractMetadata({
        contract,
        rawProperties: new Map(),
        mirroredProperties: new Map([['readyLatency', '2']]),
        location: 'component.xml busInterfaces.stream',
      })
    ).toEqual({ interfaceProperties: { readyLatency: 2 } });
  });

  it('rejects conflicting standard and mirrored values', () => {
    expect(() =>
      importVendorContractMetadata({
        contract,
        rawProperties: new Map([['symbolsPerBeat', '5']]),
        mirroredProperties: new Map([['symbolsPerBeat', '4']]),
        location: 'component.xml busInterfaces.stream',
      })
    ).toThrow(
      "component.xml busInterfaces.stream.symbolsPerBeat: standard value '5' conflicts with IPCraft mirror '4'"
    );
  });

  it('rejects a mirrored key that the contract does not declare', () => {
    expect(() =>
      importVendorContractMetadata({
        contract,
        rawProperties: new Map(),
        mirroredProperties: new Map([['futureProperty', '1']]),
        location: 'component.xml busInterfaces.stream',
      })
    ).toThrow(
      'component.xml busInterfaces.stream.mirror.futureProperty is not declared by the bus contract'
    );
  });

  it('preserves explicitly mirrored endianness without a standard ordering value', () => {
    expect(
      importVendorContractMetadata({
        contract,
        rawProperties: new Map(),
        mirroredProperties: new Map([['endianness', 'little']]),
        location: 'component.xml busInterfaces.stream',
      })
    ).toEqual({ endianness: 'little' });
  });
});

describe('isDeclarativeContract', () => {
  it('recognizes only normalized version-one contracts', () => {
    expect(isDeclarativeContract(undefined)).toBe(false);
    expect(isDeclarativeContract({ version: null } as BusDefinitionContract)).toBe(false);
    expect(isDeclarativeContract({ version: 1 } as BusDefinitionContract)).toBe(true);
  });
});
