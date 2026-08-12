import type { BusDefinitionFile } from '../../../domain/busDefinition.types';
import {
  canonicalizeBusType,
  isConsumerInterface,
  normalizeBusLibrary,
  normalizeInterfaceMode,
} from '../../../shared/busContracts';

const definitions: BusDefinitionFile = {
  TEST: {
    busType: { vendor: 'acme.com', library: 'busif', name: 'stream', version: '1.0' },
    aliases: [
      { kind: 'short', value: 'TSTREAM' },
      {
        kind: 'vlnv',
        vendor: 'vendor.com',
        library: 'interface',
        name: 'foreign-stream',
        version: '*',
      },
      {
        kind: 'vlnv',
        vendor: 'vendor.com',
        library: 'interface',
        name: 'fixed-stream',
        version: '2.0',
      },
    ],
    contract: {
      version: 1,
      interfaceKind: 'streaming',
      modePolicy: {
        producer: 'source',
        consumer: 'sink',
        aliases: { master: 'source', slave: 'sink' },
      },
      interfaceProperties: {},
      constraints: [],
    },
    ports: [
      {
        name: 'data',
        width: 32,
        direction: 'out',
        presence: 'required',
        role: 'data',
        widthPolicy: 'root',
      },
    ],
  },
};

const library = normalizeBusLibrary([
  { sourceFile: '/extension/test.yml', sourceKind: 'builtin', definitions },
]);

describe('canonicalizeBusType', () => {
  it('matches a trimmed exact canonical VLNV first', () => {
    expect(canonicalizeBusType(' acme.com:busif:stream:1.0 ', library)).toMatchObject({
      key: 'TEST',
      canonicalVlnv: 'acme.com:busif:stream:1.0',
      matchedBy: 'canonicalVlnv',
    });
  });

  it('matches trimmed short aliases case-insensitively', () => {
    expect(canonicalizeBusType('  tStReAm ', library)).toMatchObject({
      key: 'TEST',
      matchedBy: 'shortAlias',
    });
  });

  it('matches a structured alias with an explicit wildcard version', () => {
    expect(
      canonicalizeBusType('vendor.com:interface:foreign-stream:2026.1', library)
    ).toMatchObject({ key: 'TEST', matchedBy: 'structuredAlias' });
  });

  it('requires an exact declared structured-alias version without a wildcard', () => {
    expect(canonicalizeBusType('vendor.com:interface:fixed-stream:2.0', library)).toMatchObject({
      key: 'TEST',
      matchedBy: 'structuredAlias',
    });
    expect(canonicalizeBusType('vendor.com:interface:fixed-stream:2.1', library)).toBeNull();
  });

  it.each([
    'other.com:interface:foreign-stream:1.0',
    'vendor.com:other:foreign-stream:1.0',
    'vendor.com:interface:foreign-stream-extra:1.0',
    'prefix-tstream-suffix',
    'acme.com:busif:stream',
  ])('does not guess a match for %s', (type) => {
    expect(canonicalizeBusType(type, library)).toBeNull();
  });
});

describe('interface mode normalization', () => {
  const contract = library.definitions.TEST;

  it.each([
    ['source', 'source'],
    [' SOURCE ', 'source'],
    ['sink', 'sink'],
    ['master', 'source'],
    ['SLAVE', 'sink'],
  ])('normalizes %s to %s', (mode, expected) => {
    expect(normalizeInterfaceMode(contract, mode)).toBe(expected);
  });

  it('returns null for an undeclared mode', () => {
    expect(normalizeInterfaceMode(contract, 'initiator')).toBeNull();
  });

  it('recognizes consumer aliases through the normalized mode policy', () => {
    expect(isConsumerInterface(contract, 'sink')).toBe(true);
    expect(isConsumerInterface(contract, 'slave')).toBe(true);
    expect(isConsumerInterface(contract, 'source')).toBe(false);
    expect(isConsumerInterface(contract, 'unknown')).toBe(false);
  });
});
