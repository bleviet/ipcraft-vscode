import type { BusInterface } from '../../../domain/ipcore.types';
import {
  canonicalizeBusInterfacePorts,
  matchBusPortRole,
  portNameCandidates,
  resolveDefaultPhysicalSuffix,
  resolveEffectivePortPolarity,
  resolveInterfaceRole,
  resolvePhysicalSuffix,
} from '../../../shared/busContracts/polarity';
import { builtinBusLibrary } from '../../helpers/busLibrary';

const contract = builtinBusLibrary().definitions.AVALON_MEMORY_MAPPED;
const POLARITY_PORTS = [
  ['byteenable', 'byteenable_n'],
  ['readdatavalid', 'readdatavalid_n'],
  ['waitrequest', 'waitrequest_n'],
  ['read', 'read_n'],
  ['write', 'write_n'],
] as const;

function busInterface(overrides: Partial<BusInterface>): BusInterface {
  return {
    name: 'S',
    type: contract.canonicalVlnv,
    mode: 'slave',
    ...overrides,
  };
}

describe('bus port polarity policy', () => {
  it('offers canonical and declared role names without synthesizing spellings', () => {
    expect(
      portNameCandidates({
        name: 'request',
        polarity: {
          default: 'activeHigh',
          roles: { activeHigh: 'request_asserted', activeLow: 'request_deasserted' },
        },
      })
    ).toEqual([
      {
        suffix: 'request_asserted',
        roleSuffix: 'request_asserted',
        polarity: 'activeHigh',
        isDefaultRole: true,
      },
      {
        suffix: 'request',
        roleSuffix: 'request_asserted',
        polarity: 'activeHigh',
        isDefaultRole: true,
      },
      { suffix: 'request_deasserted', roleSuffix: 'request_deasserted', polarity: 'activeLow' },
    ]);
  });

  it('matches canonical names and declared roles case-insensitively', () => {
    expect(matchBusPortRole(contract.ports, 'BYTEENABLE_N')).toMatchObject({
      port: { name: 'byteenable' },
      polarity: 'activeLow',
    });
    expect(matchBusPortRole(contract.ports, 'READ')).toMatchObject({
      port: { name: 'read' },
      polarity: 'activeHigh',
    });
  });

  it.each([
    ['byteenable_n', 'byteenable'],
    ['readdatavalid_n', 'readdatavalid'],
    ['waitrequest_n', 'waitrequest'],
    ['read_n', 'read'],
    ['write_n', 'write'],
  ])('canonicalizes the %s legacy alias', (legacyName, canonicalName) => {
    const result = canonicalizeBusInterfacePorts(
      contract,
      busInterface({ useOptionalPorts: [legacyName] }),
      0
    );

    expect(result.busInterface.useOptionalPorts).toEqual([canonicalName]);
    expect(result.busInterface.portPolarityOverrides).toEqual({ [canonicalName]: 'activeLow' });
  });

  it('canonicalizes a declared legacy role in absent ports', () => {
    const result = canonicalizeBusInterfacePorts(
      contract,
      busInterface({ absentPorts: ['READ_N'] }),
      0
    );

    expect(result.busInterface.absentPorts).toEqual(['read']);
    expect(result.busInterface.portPolarityOverrides).toEqual({ read: 'activeLow' });
  });

  it('canonicalizes legacy selections and keyed overrides', () => {
    const result = canonicalizeBusInterfacePorts(
      contract,
      busInterface({
        useOptionalPorts: ['read', 'write', 'read_n'],
        portWidthOverrides: { read_n: 1 },
        portNameOverrides: { read_n: 'odd_read' },
      }),
      0
    );

    expect(result.busInterface.useOptionalPorts).toEqual(['write', 'read']);
    expect(result.busInterface.portPolarityOverrides).toEqual({ read: 'activeLow' });
    expect(result.busInterface.portWidthOverrides).toEqual({ read: 1 });
    expect(result.busInterface.portNameOverrides).toEqual({ read: 'odd_read' });
    expect(result.mutations).toEqual([
      [
        ['busInterfaces', 0, 'useOptionalPorts'],
        ['write', 'read'],
      ],
      [['busInterfaces', 0, 'portWidthOverrides'], { read: 1 }],
      [['busInterfaces', 0, 'portNameOverrides'], { read: 'odd_read' }],
      [['busInterfaces', 0, 'portPolarityOverrides'], { read: 'activeLow' }],
    ]);
  });

  it.each(POLARITY_PORTS)(
    'keeps identity-bearing active-low %s when a keyed map uses the canonical name',
    (canonicalName, activeLowRole) => {
      const result = canonicalizeBusInterfacePorts(
        contract,
        busInterface({
          useOptionalPorts: [activeLowRole],
          portNameOverrides: { [canonicalName]: 'literal' },
        }),
        0
      );

      expect(result.busInterface.portPolarityOverrides).toEqual({
        [canonicalName]: 'activeLow',
      });
      expect(result.busInterface.portNameOverrides).toEqual({ [canonicalName]: 'literal' });
    }
  );

  it.each(POLARITY_PORTS)(
    'keeps identity-bearing canonical %s when a keyed map uses the active-low alias',
    (canonicalName, activeLowRole) => {
      const result = canonicalizeBusInterfacePorts(
        contract,
        busInterface({
          useOptionalPorts: [canonicalName],
          portNameOverrides: { [activeLowRole]: 'literal' },
        }),
        0
      );

      expect(result.busInterface.portPolarityOverrides).toBeUndefined();
      expect(result.busInterface.portNameOverrides).toEqual({ [canonicalName]: 'literal' });
    }
  );

  it.each(POLARITY_PORTS)(
    'uses a lone active-low %s width key as fallback polarity evidence',
    (canonicalName, activeLowRole) => {
      const result = canonicalizeBusInterfacePorts(
        contract,
        busInterface({ portWidthOverrides: { [activeLowRole]: 1 } }),
        0
      );

      expect(result.busInterface.portWidthOverrides).toEqual({ [canonicalName]: 1 });
      expect(result.busInterface.portPolarityOverrides).toEqual({
        [canonicalName]: 'activeLow',
      });
    }
  );

  it.each(POLARITY_PORTS)(
    'uses a lone active-low %s name key as fallback polarity evidence',
    (canonicalName, activeLowRole) => {
      const result = canonicalizeBusInterfacePorts(
        contract,
        busInterface({ portNameOverrides: { [activeLowRole]: 'literal' } }),
        0
      );

      expect(result.busInterface.portNameOverrides).toEqual({ [canonicalName]: 'literal' });
      expect(result.busInterface.portPolarityOverrides).toEqual({
        [canonicalName]: 'activeLow',
      });
    }
  );

  it.each(POLARITY_PORTS)(
    'uses the last alias occurrence in a keyed %s map',
    (canonicalName, activeLowRole) => {
      const result = canonicalizeBusInterfacePorts(
        contract,
        busInterface({
          portNameOverrides: {
            [canonicalName]: 'first',
            [activeLowRole]: 'last',
          },
        }),
        0
      );

      expect(result.busInterface.portNameOverrides).toEqual({ [canonicalName]: 'last' });
      expect(result.busInterface.portPolarityOverrides).toEqual({
        [canonicalName]: 'activeLow',
      });
    }
  );

  it.each(POLARITY_PORTS)(
    'uses the last canonical occurrence in a keyed %s map',
    (canonicalName, activeLowRole) => {
      const result = canonicalizeBusInterfacePorts(
        contract,
        busInterface({
          portNameOverrides: {
            [activeLowRole]: 'first',
            [canonicalName]: 'last',
          },
        }),
        0
      );

      expect(result.busInterface.portNameOverrides).toEqual({ [canonicalName]: 'last' });
      expect(result.busInterface.portPolarityOverrides).toBeUndefined();
    }
  );

  it('preserves absentPorts precedence over useOptionalPorts for conflicting identities', () => {
    const activeHigh = canonicalizeBusInterfacePorts(
      contract,
      busInterface({ useOptionalPorts: ['read_n'], absentPorts: ['read'] }),
      0
    );
    const activeLow = canonicalizeBusInterfacePorts(
      contract,
      busInterface({ useOptionalPorts: ['read'], absentPorts: ['read_n'] }),
      0
    );

    expect(activeHigh.busInterface.portPolarityOverrides).toBeUndefined();
    expect(activeLow.busInterface.portPolarityOverrides).toEqual({ read: 'activeLow' });
  });

  it('uses the last legacy alias while retaining unrelated entries in order', () => {
    const result = canonicalizeBusInterfacePorts(
      contract,
      busInterface({
        useOptionalPorts: ['unknown', 'read', 'write', 'read_n'],
        portWidthOverrides: { unknown: 3, read: 1, read_n: 2 },
      }),
      0
    );

    expect(result.busInterface.useOptionalPorts).toEqual(['unknown', 'write', 'read']);
    expect(result.busInterface.portWidthOverrides).toEqual({ unknown: 3, read: 2 });
  });

  it('canonicalizes case-insensitive polarity override keys', () => {
    const result = canonicalizeBusInterfacePorts(
      contract,
      busInterface({
        portPolarityOverrides: { READ: 'activeLow', write: 'activeLow' },
      }),
      0
    );

    expect(result.busInterface.portPolarityOverrides).toEqual({
      read: 'activeLow',
      write: 'activeLow',
    });
    expect(result.mutations).toContainEqual([
      ['busInterfaces', 0, 'portPolarityOverrides'],
      { read: 'activeLow', write: 'activeLow' },
    ]);
  });

  it('uses the last duplicate-case polarity override and preserves unrelated entries', () => {
    const result = canonicalizeBusInterfacePorts(
      contract,
      busInterface({
        portPolarityOverrides: {
          read: 'activeHigh',
          write: 'activeLow',
          READ: 'activeLow',
        },
      }),
      0
    );

    expect(result.busInterface.portPolarityOverrides).toEqual({
      write: 'activeLow',
      read: 'activeLow',
    });
  });

  it('emits whole-field deletions when canonicalization leaves an empty field', () => {
    const result = canonicalizeBusInterfacePorts(
      contract,
      busInterface({
        useOptionalPorts: [],
        portWidthOverrides: {},
        portNameOverrides: {},
        absentPorts: [],
        portPolarityOverrides: {},
      }),
      0
    );

    expect(result.busInterface.useOptionalPorts).toBeUndefined();
    expect(result.busInterface.portWidthOverrides).toBeUndefined();
    expect(result.busInterface.portNameOverrides).toBeUndefined();
    expect(result.busInterface.absentPorts).toBeUndefined();
    expect(result.busInterface.portPolarityOverrides).toBeUndefined();
    expect(result.mutations).toEqual([
      [['busInterfaces', 0, 'useOptionalPorts'], undefined],
      [['busInterfaces', 0, 'portWidthOverrides'], undefined],
      [['busInterfaces', 0, 'portNameOverrides'], undefined],
      [['busInterfaces', 0, 'absentPorts'], undefined],
      [['busInterfaces', 0, 'portPolarityOverrides'], undefined],
    ]);
  });

  it.each(POLARITY_PORTS)(
    'gives an explicit canonical %s polarity override precedence over a legacy role',
    (canonicalName, activeLowRole) => {
      const result = canonicalizeBusInterfacePorts(
        contract,
        busInterface({
          useOptionalPorts: [activeLowRole],
          portPolarityOverrides: { [canonicalName]: 'activeHigh' },
        }),
        0
      );

      expect(result.busInterface.useOptionalPorts).toEqual([canonicalName]);
      expect(result.busInterface.portPolarityOverrides).toEqual({
        [canonicalName]: 'activeHigh',
      });
      expect(result.busInterface.portNameOverrides).toEqual({
        [canonicalName]: activeLowRole,
      });
    }
  );

  it('resolves a literal physical name independently of declared polarity roles', () => {
    const read = contract.ports.find((port) => port.name === 'read');
    expect(read).toBeDefined();

    const configured = busInterface({
      portPolarityOverrides: { read: 'activeLow' },
      portNameOverrides: { read: 'physical_read' },
    });

    expect(resolveEffectivePortPolarity(read!, configured)).toBe('activeLow');
    expect(resolveInterfaceRole(read!, configured)).toBe('read_n');
    expect(resolvePhysicalSuffix(read!, configured)).toBe('physical_read');
  });

  it('preserves vendor role casing while deriving a lowercase default physical suffix', () => {
    const awaddr = builtinBusLibrary().definitions.AXI4_LITE.ports.find(
      (port) => port.name === 'AWADDR'
    );
    expect(awaddr).toBeDefined();

    const configured = busInterface({ type: 'AXI4L' });
    expect(resolveInterfaceRole(awaddr!, configured)).toBe('AWADDR');
    expect(resolveDefaultPhysicalSuffix(awaddr!)).toBe('awaddr');
    expect(resolvePhysicalSuffix(awaddr!, configured)).toBe('awaddr');
  });
});
