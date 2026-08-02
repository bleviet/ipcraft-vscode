import discoveredFixture from '../../../fixtures/system-verification/discovered-system.json';
import type {
  DiscoveredAxiRoute,
  DiscoveredSystem,
  SystemVerificationConfig,
  VerificationVector,
} from '../../../../domain/systemVerification.types';
import type {
  NormalizedField,
  NormalizedMemoryMap,
  NormalizedRegister,
} from '../../../../domain/internal.types';
import {
  buildDeterministicVectors,
  buildSystemVerificationPlan,
} from '../../../../services/systemVerification/SystemVerificationPlanner';

const config: SystemVerificationConfig = {
  recreateScript: 'hardware/system/create_system.tcl',
  part: 'xc7z020clg484-1',
  designName: 'system',
  clockPath: '/sys_clk',
  clockPeriodNs: 10,
  resetPath: '/sys_rst_n',
  resetActiveLow: true,
  resetCycles: 5,
  target: {
    driveInterfacePath: '/S_AXI_TEST',
    instancePath: '/control_0',
    memoryMap: '../ip/control.mm.yml',
  },
};

const discovered = discoveredFixture as DiscoveredSystem;

const controlRegister: NormalizedRegister = {
  rowId: 'control',
  name: 'CONTROL',
  offset: 4,
  size: 32,
  resetValue: 0,
  description: '',
  fields: [
    field('enable', 'ENABLE', 0, 1, 'read-write', 0),
    field('mode', 'MODE', 1, 1, 'read-write', 0),
    field('status', 'STATUS', 8, 1, 'read-only', 1),
    field('event', 'EVENT', 9, 1, 'write-1-to-clear', 1),
    field('trigger', 'TRIGGER', 10, 1, 'write-self-clearing', 0),
    field('sample', 'SAMPLE', 11, 1, 'volatile', 0),
  ],
};

const memoryMap: NormalizedMemoryMap = {
  name: 'CONTROL',
  description: '',
  addressBlocks: [
    {
      rowId: 'control-block',
      name: 'REGISTERS',
      baseAddress: 0,
      range: 0x20,
      usage: 'register',
      description: '',
      defaultRegWidth: 32,
      registers: [
        {
          rowId: 'status-register',
          name: 'STATUS',
          offset: 0,
          size: 32,
          resetValue: 1,
          access: 'read-only',
          description: '',
          fields: [],
        },
        controlRegister,
      ],
    },
  ],
};

const accessCases: ReadonlyArray<
  readonly [
    string,
    ReadonlyArray<{
      readonly kind: VerificationVector['kind'];
      readonly expectedValue: number;
      readonly compareMask: number;
      readonly writeValue?: number;
    }>,
    string | undefined,
  ]
> = [
  [
    'read-write',
    [
      { kind: 'resetRead', expectedValue: 1, compareMask: 1 },
      { kind: 'writeReadback', expectedValue: 0, compareMask: 1, writeValue: 0 },
      { kind: 'writeReadback', expectedValue: 1, compareMask: 1, writeValue: 1 },
      { kind: 'writeReadback', expectedValue: 1, compareMask: 1, writeValue: 1 },
    ],
    undefined,
  ],
  ['read-only', [{ kind: 'resetRead', expectedValue: 1, compareMask: 1 }], 'read-only'],
  ['write-only', [], undefined],
  ['write-1-to-clear', [], undefined],
  [
    'read-write-1-to-clear',
    [{ kind: 'resetRead', expectedValue: 1, compareMask: 1 }],
    'write-one-to-clear',
  ],
  ['write-self-clearing', [], undefined],
  [
    'read-write-self-clearing',
    [{ kind: 'resetRead', expectedValue: 1, compareMask: 1 }],
    'side-effect',
  ],
];

function field(
  rowId: string,
  name: string,
  offset: number,
  width: number,
  access: string,
  resetValue: number
): NormalizedField {
  const mostSignificantBit = offset + width - 1;
  return {
    rowId,
    name,
    bits: width === 1 ? `[${offset}]` : `[${mostSignificantBit}:${offset}]`,
    offset,
    width,
    access,
    resetValue,
    description: '',
  };
}

function withRoutes(routes: ReadonlyArray<DiscoveredAxiRoute>): DiscoveredSystem {
  return { ...discovered, axiRoutes: routes };
}

describe('SystemVerificationPlanner', () => {
  it('uses the discovered system base plus register offset in address order', () => {
    const plan = buildSystemVerificationPlan(config, discovered, memoryMap);

    expect(plan).toMatchObject({
      wrapperLanguage: 'VHDL',
      boundaryInterface: { path: '/S_AXI_TEST', addressWidth: 32, dataWidth: 32 },
      clockPort: { path: '/sys_clk', type: 'clock', width: 1 },
      resetPort: { path: '/sys_rst_n', type: 'reset', width: 1 },
    });
    expect(plan.transactions).toMatchObject([
      { registerName: 'STATUS', address: 0x44a00000 },
      { registerName: 'CONTROL', address: 0x44a00004 },
    ]);
    expect(
      plan.transactions[1].vectors.every(
        (vector: VerificationVector) => vector.address === 0x44a00004
      )
    ).toBe(true);
  });

  it('requires the configured boundary interface path to be discovered exactly', () => {
    const configWithPrefixPath: SystemVerificationConfig = {
      ...config,
      target: { ...config.target, driveInterfacePath: '/S_AXI' },
    };

    expect(() => buildSystemVerificationPlan(configWithPrefixPath, discovered, memoryMap)).toThrow(
      /target\.driveInterfacePath .* is not a discovered boundary interface/
    );
  });

  it('rejects a missing target instance before resolving a route', () => {
    const configWithMissingInstance: SystemVerificationConfig = {
      ...config,
      target: { ...config.target, instancePath: '/missing_0' },
    };

    expect(() =>
      buildSystemVerificationPlan(configWithMissingInstance, discovered, memoryMap)
    ).toThrow(/target\.instancePath .* is not a discovered instance/);
  });

  it('rejects an unsupported route protocol', () => {
    const nonAxi4LiteRoute: DiscoveredAxiRoute = {
      ...discovered.axiRoutes[0],
      protocol: 'AXI4',
    };

    expect(() =>
      buildSystemVerificationPlan(config, withRoutes([nonAxi4LiteRoute]), memoryMap)
    ).toThrow(/target route .* is not AXI4-Lite/);
  });

  it('rejects a boundary whose physical channels are not the supported narrow AXI4-Lite shape', () => {
    const boundaryInterface = discovered.boundaryInterfaces[0];
    const fullAxiShape: DiscoveredSystem = {
      ...discovered,
      boundaryInterfaces: [
        {
          ...boundaryInterface,
          signals: [...boundaryInterface.signals, { name: 'awlen', direction: 'in', width: 8 }],
        },
      ],
    };

    expect(() => buildSystemVerificationPlan(config, fullAxiShape, memoryMap)).toThrow(
      /target\.driveInterfacePath \/S_AXI_TEST.*physical.*awlen/i
    );
  });

  it('rejects unsupported wrapper language and address width before scaffolding', () => {
    expect(() =>
      buildSystemVerificationPlan(config, { ...discovered, wrapperLanguage: 'Verilog' }, memoryMap)
    ).toThrow(/wrapper language Verilog.*VHDL/i);

    const narrowAddressRoute = { ...discovered.axiRoutes[0], addressWidth: 24 };
    expect(() =>
      buildSystemVerificationPlan(config, withRoutes([narrowAddressRoute]), memoryMap)
    ).toThrow(/address width 24.*32/i);
  });

  it('requires typed scalar input clock and reset boundary ports', () => {
    const invalidPorts: DiscoveredSystem = {
      ...discovered,
      boundaryPorts: discovered.boundaryPorts.map((port) =>
        port.path === '/sys_rst_n' ? { ...port, width: 2 } : port
      ),
    };

    expect(() => buildSystemVerificationPlan(config, invalidPorts, memoryMap)).toThrow(
      /resetPath \/sys_rst_n.*scalar input reset/i
    );
  });

  it('rejects an ambiguous compatible route', () => {
    const duplicateRoute: DiscoveredAxiRoute = {
      ...discovered.axiRoutes[0],
      baseAddress: 0x44b00000,
    };

    expect(() =>
      buildSystemVerificationPlan(
        config,
        withRoutes([discovered.axiRoutes[0], duplicateRoute]),
        memoryMap
      )
    ).toThrow(/target.*has more than one AXI4-Lite route/);
  });

  it('rejects a route range that cannot cover the configured memory map', () => {
    const undersizedRoute: DiscoveredAxiRoute = {
      ...discovered.axiRoutes[0],
      addressRange: 0x1f,
    };

    expect(() =>
      buildSystemVerificationPlan(config, withRoutes([undersizedRoute]), memoryMap)
    ).toThrow(/addressRange .* smaller than memory map range/);
  });

  it('emits reset, zero, writable-ones, and per-bit walking-one vectors deterministically', () => {
    expect(buildDeterministicVectors(controlRegister, 4)).toEqual([
      {
        kind: 'resetRead',
        address: 4,
        expectedValue: 0x100,
        compareMask: 0x103,
        registerName: 'CONTROL',
        skippedReason:
          'write/readback excludes read-only, write-one-to-clear, side-effect, and volatile fields',
      },
      {
        kind: 'writeReadback',
        address: 4,
        expectedValue: 0,
        compareMask: 0x3,
        writeValue: 0,
        registerName: 'CONTROL',
        skippedReason:
          'write/readback excludes read-only, write-one-to-clear, side-effect, and volatile fields',
      },
      {
        kind: 'writeReadback',
        address: 4,
        expectedValue: 0x3,
        compareMask: 0x3,
        writeValue: 0x3,
        registerName: 'CONTROL',
        skippedReason:
          'write/readback excludes read-only, write-one-to-clear, side-effect, and volatile fields',
      },
      {
        kind: 'writeReadback',
        address: 4,
        expectedValue: 0x1,
        compareMask: 0x3,
        writeValue: 0x1,
        registerName: 'CONTROL',
        skippedReason:
          'write/readback excludes read-only, write-one-to-clear, side-effect, and volatile fields',
      },
      {
        kind: 'writeReadback',
        address: 4,
        expectedValue: 0x2,
        compareMask: 0x3,
        writeValue: 0x2,
        registerName: 'CONTROL',
        skippedReason:
          'write/readback excludes read-only, write-one-to-clear, side-effect, and volatile fields',
      },
    ]);
  });

  it('retains a reset read and explicit reason when a register has no safe writable bits', () => {
    const readOnlyRegister: NormalizedRegister = {
      ...controlRegister,
      name: 'READ_ONLY',
      fields: [field('read-only', 'VALUE', 0, 1, 'read-only', 1)],
    };

    expect(buildDeterministicVectors(readOnlyRegister, 4)).toEqual([
      {
        kind: 'resetRead',
        address: 4,
        expectedValue: 1,
        compareMask: 1,
        registerName: 'READ_ONLY',
        skippedReason: 'write/readback excludes read-only fields',
      },
    ]);
  });

  it.each(accessCases)(
    'uses legal reset reads and skips write/readback vectors for %s fields',
    (
      access: string,
      expected: ReadonlyArray<{
        readonly kind: VerificationVector['kind'];
        readonly expectedValue: number;
        readonly compareMask: number;
        readonly writeValue?: number;
      }>,
      skippedAccess: string | undefined
    ) => {
      const register: NormalizedRegister = {
        ...controlRegister,
        name: `ACCESS_${access}`,
        fields: [field(`field-${access}`, 'VALUE', 0, 1, access, 1)],
      };

      const vectors = buildDeterministicVectors(register, 4);

      expect(vectors).toMatchObject(expected);
      if (skippedAccess) {
        expect(vectors[0].skippedReason).toContain(skippedAccess);
      }
    }
  );

  it('accepts a route range ending after the final flat-array element', () => {
    const flatArray: NormalizedRegister = {
      ...controlRegister,
      name: 'CHANNEL',
      offset: 0x10,
      fields: [field('channel-value', 'VALUE', 0, 1, 'read-write', 0)],
      __kind: 'array',
      count: 3,
      stride: 8,
      registers: [],
    };
    const flatArrayMap = memoryMapWithRegisters([flatArray]);
    const route: DiscoveredAxiRoute = { ...discovered.axiRoutes[0], addressRange: 0x44 };

    expect(
      buildSystemVerificationPlan(config, withRoutes([route]), flatArrayMap).transactions
    ).toMatchObject([
      { registerName: 'CHANNEL_0', address: 0x44a00030 },
      { registerName: 'CHANNEL_1', address: 0x44a00038 },
      { registerName: 'CHANNEL_2', address: 0x44a00040 },
    ]);
  });

  it('rejects a flat-array route range before its final occupied byte', () => {
    const flatArray: NormalizedRegister = {
      ...controlRegister,
      name: 'CHANNEL',
      offset: 0x10,
      fields: [field('channel-value', 'VALUE', 0, 1, 'read-write', 0)],
      __kind: 'array',
      count: 3,
      stride: 8,
      registers: [],
    };
    const route: DiscoveredAxiRoute = { ...discovered.axiRoutes[0], addressRange: 0x43 };

    expect(() =>
      buildSystemVerificationPlan(config, withRoutes([route]), memoryMapWithRegisters([flatArray]))
    ).toThrow(/addressRange .* smaller than memory map range/);
  });

  it('accepts a nested-array route range ending after the final child element', () => {
    const nestedArray: NormalizedRegister = {
      ...controlRegister,
      name: 'GROUP',
      offset: 0,
      fields: [],
      __kind: 'array',
      count: 2,
      stride: 0x20,
      registers: [
        {
          ...controlRegister,
          rowId: 'status',
          name: 'STATUS',
          offset: 4,
          fields: [],
          __kind: 'array',
          count: 1,
          stride: 4,
          registers: [
            {
              ...controlRegister,
              rowId: 'lane',
              name: 'LANE',
              offset: 8,
              fields: [field('lane-value', 'VALUE', 0, 1, 'read-write', 0)],
              __kind: 'array',
              count: 2,
              stride: 8,
              registers: [],
            },
          ],
        },
      ],
    };
    const route: DiscoveredAxiRoute = { ...discovered.axiRoutes[0], addressRange: 0x58 };

    expect(
      buildSystemVerificationPlan(
        config,
        withRoutes([route]),
        memoryMapWithRegisters([nestedArray])
      ).transactions
    ).toMatchObject([
      { registerName: 'GROUP_0_STATUS_LANE_0', address: 0x44a0002c },
      { registerName: 'GROUP_0_STATUS_LANE_1', address: 0x44a00034 },
      { registerName: 'GROUP_1_STATUS_LANE_0', address: 0x44a0004c },
      { registerName: 'GROUP_1_STATUS_LANE_1', address: 0x44a00054 },
    ]);
  });
});

function memoryMapWithRegisters(registers: NormalizedRegister[]): NormalizedMemoryMap {
  return {
    ...memoryMap,
    addressBlocks: [
      {
        ...memoryMap.addressBlocks[0],
        baseAddress: 0x20,
        range: null,
        registers,
      },
    ],
  };
}
