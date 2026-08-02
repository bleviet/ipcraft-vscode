import {
  createSystemVerificationConfigText,
  parseSystemVerificationConfig,
} from '../../../../services/systemVerification/SystemVerificationConfig';
import {
  DiscoveredAxiRoute,
  DiscoveredBoundaryInterface,
  DiscoveredSystem,
  SystemVerificationConfig,
  SystemVerificationLifecycleEvent,
  SystemVerificationPlan,
  SystemVerificationResult,
  SystemVerificationTarget,
  SystemVerificationTransaction,
  VerificationVector,
} from '../../../../domain/systemVerification.types';

type IfEquals<Left, Right, WhenEqual, WhenDifferent> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? WhenEqual
    : WhenDifferent;

type ReadonlyKeys<Value> = {
  [Key in keyof Value]-?: IfEquals<
    { [Property in Key]: Value[Key] },
    { readonly [Property in Key]: Value[Key] },
    Key,
    never
  >;
}[keyof Value];

type Expect<Condition extends true> = Condition;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;

type _SystemVerificationDomainTypesAreImmutable = Expect<
  Equal<ReadonlyKeys<SystemVerificationTarget>, keyof SystemVerificationTarget> &
    Equal<ReadonlyKeys<SystemVerificationConfig>, keyof SystemVerificationConfig> &
    Equal<ReadonlyKeys<DiscoveredAxiRoute>, keyof DiscoveredAxiRoute> &
    Equal<ReadonlyKeys<DiscoveredSystem>, keyof DiscoveredSystem> &
    Equal<ReadonlyKeys<VerificationVector>, keyof VerificationVector> &
    Equal<ReadonlyKeys<SystemVerificationTransaction>, keyof SystemVerificationTransaction> &
    Equal<ReadonlyKeys<SystemVerificationPlan>, keyof SystemVerificationPlan> &
    Equal<ReadonlyKeys<SystemVerificationLifecycleEvent>, keyof SystemVerificationLifecycleEvent> &
    Equal<ReadonlyKeys<SystemVerificationResult>, keyof SystemVerificationResult>
>;

type _SystemVerificationCollectionsAreReadonly = Expect<
  Equal<DiscoveredSystem['boundaryInterfaces'], ReadonlyArray<DiscoveredBoundaryInterface>> &
    Equal<DiscoveredSystem['instancePaths'], ReadonlyArray<string>> &
    Equal<DiscoveredSystem['axiRoutes'], ReadonlyArray<DiscoveredAxiRoute>> &
    Equal<SystemVerificationTransaction['vectors'], ReadonlyArray<VerificationVector>> &
    Equal<SystemVerificationPlan['transactions'], ReadonlyArray<SystemVerificationTransaction>>
>;

const validYaml = `recreateScript: hardware/system/create_system.tcl
part: xc7z020clg484-1
designName: system
clockPath: /sys_clk
clockPeriodNs: 10
resetPath: /sys_rst_n
resetActiveLow: true
resetCycles: 5
target:
  driveInterfacePath: /S_AXI_TEST
  instancePath: /control_0
  memoryMap: ../ip/control.mm.yml
`;

const configPath = '/work/verification/system-verification.yml';

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

describe('SystemVerificationConfig', () => {
  it('accepts an explicit V1 AXI4-Lite configuration', () => {
    expect(parseSystemVerificationConfig(validYaml, configPath)).toMatchObject({
      clockPeriodNs: 10,
      resetActiveLow: true,
      resetCycles: 5,
    });
  });

  it.each([
    [
      validYaml.replace('clockPeriodNs: 10', 'clockPeriodNs: 0'),
      /clockPeriodNs must be greater than zero/,
    ],
    [
      validYaml.replace('resetCycles: 5', 'resetCycles: 0'),
      /resetCycles must be a positive integer/,
    ],
  ])('rejects invalid configuration', (yaml, message) => {
    expect(() => parseSystemVerificationConfig(yaml, 'x.yml')).toThrow(message);
  });

  it('rejects a missing target path with its field name', () => {
    expect(() =>
      parseSystemVerificationConfig(
        validYaml.replace('driveInterfacePath: /S_AXI_TEST', 'driveInterfacePath: '),
        configPath
      )
    ).toThrow(/target\.driveInterfacePath/);
  });

  it.each([
    [
      validYaml.replace('clockPeriodNs: 10', 'clock_period_ns: 10'),
      /clock_period_ns is not supported/,
    ],
    [
      validYaml.replace('memoryMap: ../ip/control.mm.yml', 'memory_map: ../ip/control.mm.yml'),
      /target\.memory_map is not supported/,
    ],
  ])('rejects unsupported camelCase violations', (yaml, message) => {
    expect(() => parseSystemVerificationConfig(yaml, configPath)).toThrow(message);
  });

  it('serializes the configuration in its fixed camelCase field order', () => {
    expect(createSystemVerificationConfigText(config)).toBe(validYaml);
  });

  it('round-trips a newly generated configuration without changing relative paths', () => {
    const text = createSystemVerificationConfigText(config);

    expect(parseSystemVerificationConfig(text, configPath)).toEqual(config);
  });

  it('uses the runner lifecycle and result contract', () => {
    const event: SystemVerificationLifecycleEvent = {
      stage: 'run',
      timestamp: 42,
    };
    const result: SystemVerificationResult = {
      outcome: 'cancelled',
      runDirectory: '/work/.ipcraft/system-verification/run-1',
      logsPath: '/work/.ipcraft/system-verification/run-1/run.log',
    };
    const outcomes: ReadonlyArray<SystemVerificationResult['outcome']> = [
      'passed',
      'failed',
      'cancelled',
    ];

    expect(event).toEqual({ stage: 'run', timestamp: 42 });
    expect(result).toMatchObject({ outcome: 'cancelled', logsPath: expect.any(String) });
    expect(outcomes).toEqual(['passed', 'failed', 'cancelled']);
  });

  it('requires each verification vector to declare the bits safe to compare', () => {
    const vector: VerificationVector = {
      kind: 'writeReadback',
      address: 4,
      expectedValue: 1,
      compareMask: 1,
      writeValue: 1,
      registerName: 'CONTROL',
    };

    expect(vector.compareMask).toBe(1);
  });
});
