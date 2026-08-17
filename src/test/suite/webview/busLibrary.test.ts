import type { BusDefinitionFile, BusType } from '../../../domain/busDefinition.types';
import { normalizeBusLibrary } from '../../../shared/busContracts';
import {
  listBuiltinBusTypes,
  listLibraryBusTypes,
  portNameCandidates,
} from '../../../webview/ipcore/utils/busLibrary';

function definition(busType: BusType, sourceKind: 'builtin' | 'workspace') {
  const definitions = {
    [sourceKind === 'builtin' ? 'BUNDLED' : 'WORKSPACE']: {
      busType,
      contract: {
        version: 1,
        interfaceKind: 'conduit',
        modePolicy: { producer: 'source', consumer: 'sink', aliases: {} },
        interfaceProperties: {},
        constraints: [],
      },
      ports: [],
    },
  } as BusDefinitionFile;
  return {
    sourceFile: `/${sourceKind}/test.yml`,
    sourceKind,
    definitions,
  } as const;
}

describe('bus library presentation', () => {
  it('lists declared polarity roles with the contract default first', () => {
    expect(
      portNameCandidates({
        name: 'read',
        presence: 'optional',
        role: 'control',
        polarity: {
          default: 'activeHigh',
          roles: { activeHigh: 'read', activeLow: 'read_n' },
        },
      })
    ).toEqual([
      { suffix: 'read', roleSuffix: 'read', polarity: 'activeHigh', isDefaultRole: true },
      { suffix: 'read_n', roleSuffix: 'read_n', polarity: 'activeLow' },
    ]);
  });

  it('classifies definitions by source metadata instead of canonical VLNV allowlists', () => {
    const library = normalizeBusLibrary([
      definition(
        {
          vendor: 'acme',
          library: 'busif',
          name: 'bundled_protocol',
          version: '1.0',
          displayName: 'Bundled Protocol',
        },
        'builtin'
      ),
      definition(
        {
          vendor: 'ipcraft',
          library: 'busif',
          name: 'axi4_lite',
          version: '1.0',
          displayName: 'Workspace AXI Variant',
        },
        'workspace'
      ),
    ]);

    expect(listBuiltinBusTypes(library)).toEqual([
      { vlnv: 'acme:busif:bundled_protocol:1.0', label: 'Bundled Protocol' },
    ]);
    expect(listLibraryBusTypes(library)).toEqual([
      { vlnv: 'ipcraft:busif:axi4_lite:1.0', label: 'Workspace AXI Variant' },
    ]);
  });
});
