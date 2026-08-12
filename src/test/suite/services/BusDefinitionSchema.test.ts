import * as fs from 'fs';
import * as path from 'path';

import Ajv from 'ajv';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'ipcraft-spec', 'schemas', 'bus_definition.schema.json');

describe('bus definition schema', () => {
  const loadValidator = () => {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    return new Ajv({ strict: false, allowUnionTypes: true }).compile(schema);
  };

  it('accepts a complete version-1 streaming contract', () => {
    const validate = loadValidator();

    expect(
      validate({
        TEST_BUS: {
          busType: {
            vendor: 'acme',
            library: 'busif',
            name: 'test',
            version: '1.0',
          },
          aliases: [{ kind: 'short', value: 'TEST' }],
          contract: {
            version: 1,
            interfaceKind: 'streaming',
            modePolicy: { producer: 'source', consumer: 'sink', aliases: {} },
            interfaceProperties: {
              dataBitsPerSymbol: { type: 'integer', default: 8, minimum: 1 },
              symbolsPerBeat: {
                type: 'integer',
                minimum: 1,
                derive: {
                  operation: 'divideBy',
                  port: 'data',
                  divisorProperty: 'dataBitsPerSymbol',
                },
              },
            },
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
      })
    ).toBe(true);
  });

  it('accepts a legacy definition containing only bus metadata and ports', () => {
    const validate = loadValidator();

    expect(
      validate({
        LEGACY: {
          busType: { vendor: 'acme', library: 'busif', name: 'legacy', version: '1.0' },
          ports: [{ name: 'data', width: 'DATA_WIDTH', direction: 'out' }],
        },
      })
    ).toBe(true);
  });

  it.each([
    {
      operation: 'unknownOperation',
      port: 'data',
    },
    {
      operation: 'divideBy',
      port: 'data',
    },
    {
      operation: 'copyPort',
      port: 'data',
      divisor: 8,
    },
  ])('rejects malformed derived operation %#', (derivedWidth) => {
    const validate = loadValidator();

    expect(
      validate({
        TEST: {
          busType: { vendor: 'acme', library: 'busif', name: 'test', version: '1.0' },
          ports: [
            {
              name: 'qualifier',
              presence: 'optional',
              role: 'byteQualifier',
              widthPolicy: 'derived',
              derivedWidth,
            },
          ],
        },
      })
    ).toBe(false);
  });

  it.each([
    [{ kind: 'short' }],
    [{ kind: 'short', value: '' }],
    [{ kind: 'short', value: 'TEST', vendor: 'acme' }],
    [{ kind: 'vlnv', vendor: 'acme', library: 'busif', name: 'test' }],
    [
      {
        kind: 'vlnv',
        vendor: 'acme',
        library: 'busif',
        name: 'test',
        version: '*',
        value: 'TEST',
      },
    ],
  ])('rejects invalid aliases %#', (aliases) => {
    const validate = loadValidator();

    expect(
      validate({
        TEST: {
          busType: { vendor: 'acme', library: 'busif', name: 'test', version: '1.0' },
          aliases,
          ports: [{ name: 'data' }],
        },
      })
    ).toBe(false);
  });

  it('rejects an empty port role', () => {
    const validate = loadValidator();

    expect(
      validate({
        TEST: {
          busType: { vendor: 'acme', library: 'busif', name: 'test', version: '1.0' },
          ports: [{ name: 'data', role: '' }],
        },
      })
    ).toBe(false);
  });

  it('accepts an arbitrary non-empty port role for semantic normalization', () => {
    const validate = loadValidator();

    expect(
      validate({
        TEST: {
          busType: { vendor: 'acme', library: 'busif', name: 'test', version: '1.0' },
          ports: [{ name: 'data', role: 'workspaceSpecificRole' }],
        },
      })
    ).toBe(true);
  });
});
