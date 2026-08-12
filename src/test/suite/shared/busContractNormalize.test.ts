import type {
  BusDefinitionEntry,
  BusDefinitionFile,
  PropertyDeclaration,
} from '../../../domain/busDefinition.types';
import { normalizeBusLibrary } from '../../../shared/busContracts';

function makeEntry(overrides: Partial<BusDefinitionEntry> = {}): BusDefinitionEntry {
  return {
    busType: { vendor: 'acme', library: 'busif', name: 'test', version: '1.0' },
    aliases: [{ kind: 'short', value: 'TEST' }],
    contract: {
      version: 1,
      interfaceKind: 'streaming',
      modePolicy: { producer: 'source', consumer: 'sink', aliases: {} },
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
    ...overrides,
  };
}

function normalize(
  definitions: BusDefinitionFile,
  sourceKind: 'builtin' | 'workspace' = 'workspace'
) {
  return normalizeBusLibrary([
    {
      sourceFile: sourceKind === 'builtin' ? '/extension/test.yml' : '/workspace/test.yml',
      sourceKind,
      definitions,
    },
  ]);
}

describe('normalizeBusLibrary', () => {
  it('constructs the exact canonical VLNV and freezes normalized values', () => {
    const result = normalize({ TEST: makeEntry() });

    expect(result.definitions.TEST).toMatchObject({
      key: 'TEST',
      canonicalVlnv: 'acme:busif:test:1.0',
      sourceFile: '/workspace/test.yml',
      sourceKind: 'workspace',
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.definitions.TEST)).toBe(true);
    expect(Object.isFrozen(result.definitions.TEST.ports)).toBe(true);
  });

  it('normalizes short aliases for case-insensitive lookup', () => {
    const result = normalize({
      TEST: makeEntry({ aliases: [{ kind: 'short', value: '  TeSt Alias  ' }] }),
    });

    expect(result.aliases).toContainEqual({
      kind: 'short',
      canonicalVlnv: 'acme:busif:test:1.0',
      shortValue: 'test alias',
    });
  });

  it('defaults a missing legacy role and width policy without a warning', () => {
    const result = normalize({
      TEST: makeEntry({
        contract: undefined,
        ports: [{ name: 'legacy', width: 8, direction: 'out' }],
      }),
    });

    expect(result.definitions.TEST.ports[0]).toMatchObject({
      role: 'control',
      widthPolicy: 'root',
      presence: 'required',
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('degrades an explicit unknown workspace role to control with a warning', () => {
    const result = normalize({
      TEST: makeEntry({
        ports: [
          {
            name: 'custom',
            width: 1,
            direction: 'out',
            presence: 'required',
            role: 'payloadControl',
            widthPolicy: 'fixed',
          },
        ],
      }),
    });

    expect(result.definitions.TEST.ports[0].role).toBe('control');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'BUS_DEF_UNKNOWN_PORT_ROLE',
        severity: 'warning',
        sourceFile: '/workspace/test.yml',
        path: ['TEST', 'ports', 0, 'role'],
      })
    );
  });

  it('excludes an entry whose normalized alias collides with another definition', () => {
    const result = normalize({
      FIRST: makeEntry({
        busType: { vendor: 'acme', library: 'busif', name: 'first', version: '1.0' },
        aliases: [{ kind: 'short', value: 'SHARED' }],
      }),
      SECOND: makeEntry({
        busType: { vendor: 'acme', library: 'busif', name: 'second', version: '1.0' },
        aliases: [{ kind: 'short', value: ' shared ' }],
      }),
    });

    expect(result.definitions.FIRST).toBeDefined();
    expect(result.definitions.SECOND).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'BUS_DEF_ALIAS_COLLISION',
        severity: 'error',
        path: ['SECOND', 'aliases', 0],
      })
    );
  });

  it('excludes a contract containing a property derivation cycle', () => {
    const entry = makeEntry();
    entry.contract!.interfaceProperties = {
      first: { type: 'integer', derive: { operation: 'ceilLog2', property: 'second' } },
      second: { type: 'integer', derive: { operation: 'ceilLog2', property: 'first' } },
    };

    const result = normalize({ TEST: entry });

    expect(result.definitions.TEST).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'BUS_DEF_DERIVATION_CYCLE',
        severity: 'error',
        path: ['TEST', 'contract', 'interfaceProperties'],
      })
    );
  });

  it.each([
    ['integer default', { type: 'integer', default: false }],
    ['integer allowed values', { type: 'integer', allowedValues: [1, true] }],
    ['boolean derivation', { type: 'boolean', derive: { operation: 'copyPort', port: 'data' } }],
  ])('excludes a contract with an inconsistent %s declaration', (_label, declaration) => {
    const entry = makeEntry();
    entry.contract!.interfaceProperties = {
      invalid: declaration as PropertyDeclaration,
    };

    const result = normalize({ TEST: entry });

    expect(result.definitions.TEST).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'BUS_DEF_INVALID_PROPERTY',
        severity: 'error',
        path: ['TEST', 'contract', 'interfaceProperties', 'invalid'],
      })
    );
  });

  it('excludes a contract whose derivation references an undeclared port', () => {
    const entry = makeEntry({
      ports: [
        {
          name: 'qualifier',
          width: 4,
          direction: 'out',
          presence: 'required',
          role: 'byteQualifier',
          widthPolicy: 'derived',
          derivedWidth: { operation: 'copyPort', port: 'missing' },
        },
      ],
    });

    const result = normalize({ TEST: entry });

    expect(result.definitions.TEST).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'BUS_DEF_UNDECLARED_PORT',
        severity: 'error',
        path: ['TEST', 'ports', 0, 'derivedWidth', 'port'],
      })
    );
  });

  it('excludes a port whose override diagnostic references an undeclared rule', () => {
    const entry = makeEntry({
      ports: [
        {
          name: 'qualifier',
          width: 4,
          direction: 'out',
          presence: 'required',
          role: 'byteQualifier',
          widthPolicy: 'derived',
          derivedWidth: { operation: 'copyPort', port: 'qualifier' },
          overrideConstraintRuleId: 'RULE_THAT_DOES_NOT_EXIST',
        },
      ],
    });

    const result = normalize({ TEST: entry });

    expect(result.definitions.TEST).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'BUS_DEF_UNDECLARED_CONSTRAINT',
        severity: 'error',
        path: ['TEST', 'ports', 0, 'overrideConstraintRuleId'],
      })
    );
  });
});
