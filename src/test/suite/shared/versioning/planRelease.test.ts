import type { NormalizedMemoryMap } from '../../../../domain/internal.types';
import { normalizeMemoryMap } from '../../../../domain/parse';
import {
  isVersionedMap,
  needsDecision,
  pendingMaps,
  planRelease,
  releaseStates,
  type MapReleaseInput,
} from '../../../../shared/versioning/planRelease';
import { crc16, crc8 } from '../../../../shared/versioning/versionCrc';
import type { VersionHistory } from '../../../../shared/versioning/versionHistory';
import { versionBytes, type VersionScheme } from '../../../../shared/versioning/versionScheme';

const HASH_A = 'rs1-aaaaaaaaaaaaaaaa';
const HASH_B = 'rs1-bbbbbbbbbbbbbbbb';
const SNAP_B = [{ name: 'snap-b' }];
const S2: VersionScheme = 'major.minor';
const S3: VersionScheme = 'major.minor.patch';

/** The CRC fields a freshly written entry carries. */
const crcs = (scheme: VersionScheme, version: string): { crc8: number; crc16: number } => {
  const bytes = versionBytes(scheme, version) as number[];
  return { crc8: crc8(bytes), crc16: crc16(bytes) };
};

const history = (...entries: Array<[string, string]>): VersionHistory => ({
  registerSets: Object.fromEntries(
    [...new Set(entries.map(([, hash]) => hash))].map((hash) => [
      hash,
      { addressBlocks: [{ name: `snap-${hash}` }] },
    ])
  ),
  versions: entries.map(([version, registerSet]) => ({ version, registerSet })),
});

const input = (overrides: Partial<MapReleaseInput> = {}): MapReleaseInput => ({
  mapName: 'CSR_MAP',
  history: undefined,
  currentHash: HASH_B,
  snapshot: SNAP_B,
  versioned: true,
  ...overrides,
});

const rawMap = (extra: Record<string, unknown>): NormalizedMemoryMap =>
  normalizeMemoryMap({ name: 'M', addressBlocks: [], ...extra });

describe('isVersionedMap', () => {
  it('is false without a history key or $version refs', () => {
    expect(
      isVersionedMap(
        rawMap({
          addressBlocks: [
            { name: 'B', registers: [{ name: 'R', fields: [{ name: 'F', bits: '[3:0]' }] }] },
          ],
        })
      )
    ).toBe(false);
  });

  it('is true with a versionHistory key, even an empty one', () => {
    expect(isVersionedMap(rawMap({ versionHistory: { registerSets: {}, versions: [] } }))).toBe(
      true
    );
  });

  it('is true for a $version register reset', () => {
    expect(
      isVersionedMap(
        rawMap({
          addressBlocks: [{ name: 'B', registers: [{ name: 'R', resetValue: '$version' }] }],
        })
      )
    ).toBe(true);
  });

  it('is true for a $version field reset', () => {
    expect(
      isVersionedMap(
        rawMap({
          addressBlocks: [
            {
              name: 'B',
              registers: [
                {
                  name: 'R',
                  fields: [{ name: 'F', bits: '[7:0]', resetValue: '$version.major' }],
                },
              ],
            },
          ],
        })
      )
    ).toBe(true);
  });

  it('finds a $version ref inside a register array', () => {
    expect(
      isVersionedMap(
        rawMap({
          addressBlocks: [
            {
              name: 'B',
              registers: [
                {
                  name: 'ARR',
                  count: 2,
                  stride: 4,
                  registers: [{ name: 'R', fields: [{ name: 'F', resetValue: '$version' }] }],
                },
              ],
            },
          ],
        })
      )
    ).toBe(true);
  });
});

describe('planRelease', () => {
  it('appends the core version for an empty history', () => {
    const [plan] = planRelease([input()], '1.0.0', S3);
    expect(plan.state).toEqual({ kind: 'empty' });
    expect(plan.nextHistory).toEqual({
      registerSets: { [HASH_B]: { addressBlocks: SNAP_B } },
      versions: [{ version: '1.0.0', registerSet: HASH_B, ...crcs(S3, '1.0.0') }],
    });
  });

  it('writes nothing when up to date', () => {
    const [plan] = planRelease([input({ history: history(['1.0.0', HASH_B]) })], '1.0.0', S3);
    expect(plan.state).toEqual({ kind: 'up-to-date' });
    expect(plan.nextHistory).toBeUndefined();
  });

  it('appends the new core version when only the version changed', () => {
    const [plan] = planRelease([input({ history: history(['1.0.0', HASH_B]) })], '1.1.0', S3);
    expect(plan.state).toEqual({ kind: 'version-bump-only' });
    expect(plan.nextHistory?.versions).toEqual([
      { version: '1.0.0', registerSet: HASH_B },
      { version: '1.1.0', registerSet: HASH_B, ...crcs(S3, '1.1.0') },
    ]);
    expect(Object.keys(plan.nextHistory?.registerSets ?? {})).toEqual([HASH_B]);
  });

  describe('pending layout', () => {
    const pending = (coreVersion: string): { inputs: MapReleaseInput[]; core: string } => ({
      inputs: [input({ history: history(['1.0.0', HASH_A]) })],
      core: coreVersion,
    });

    it('throws without a decision', () => {
      const { inputs, core } = pending('1.1.0');
      expect(() => planRelease(inputs, core, S3)).toThrow(/decision/);
    });

    it('adopt appends the core version and keeps the old layout', () => {
      const { inputs, core } = pending('1.1.0');
      const [plan] = planRelease(inputs, core, S3, 'adopt');
      expect(plan.nextHistory?.versions).toEqual([
        { version: '1.0.0', registerSet: HASH_A },
        { version: '1.1.0', registerSet: HASH_B, ...crcs(S3, '1.1.0') },
      ]);
      expect(Object.keys(plan.nextHistory?.registerSets ?? {}).sort()).toEqual([HASH_A, HASH_B]);
    });

    it('adopt throws when the core version is already recorded', () => {
      const { inputs, core } = pending('1.0.0');
      expect(() => planRelease(inputs, core, S3, 'adopt')).toThrow(/already recorded/);
    });

    it('overwrite re-points the entry of the core version and drops the orphaned set', () => {
      const { inputs, core } = pending('1.0.0');
      const [plan] = planRelease(inputs, core, S3, 'overwrite');
      expect(plan.nextHistory?.versions).toEqual([
        { version: '1.0.0', registerSet: HASH_B, ...crcs(S3, '1.0.0') },
      ]);
      expect(Object.keys(plan.nextHistory?.registerSets ?? {})).toEqual([HASH_B]);
    });

    it('overwrite throws when the core version is not recorded', () => {
      const { inputs, core } = pending('1.1.0');
      expect(() => planRelease(inputs, core, S3, 'overwrite')).toThrow(/not recorded/);
    });

    it('overwrite re-points the core version entry, not the latest one', () => {
      const [plan] = planRelease(
        [input({ history: history(['1.0', HASH_A], ['1.1', 'rs1-dddddddddddddddd']) })],
        '1.0',
        S2,
        'overwrite'
      );
      expect(plan.nextHistory?.versions).toEqual([
        { version: '1.0', registerSet: HASH_B, ...crcs(S2, '1.0') },
        { version: '1.1', registerSet: 'rs1-dddddddddddddddd' },
      ]);
      expect(Object.keys(plan.nextHistory?.registerSets ?? {}).sort()).toEqual([
        HASH_B,
        'rs1-dddddddddddddddd',
      ]);
    });

    it('overwriting a non-latest core version settles: the next run is up-to-date', () => {
      const HASH_D = 'rs1-dddddddddddddddd';
      const original = history(['1.0', HASH_A], ['1.1', HASH_D]);
      const [pendingPlan] = planRelease([input({ history: original })], '1.0', S2, 'overwrite');
      expect(pendingPlan.state).toMatchObject({
        kind: 'pending',
        reference: { version: '1.0', registerSet: HASH_A },
        coreVersionRecorded: true,
      });
      expect(pendingPlan.nextHistory?.versions).toEqual([
        { version: '1.0', registerSet: HASH_B, ...crcs(S2, '1.0') },
        { version: '1.1', registerSet: HASH_D },
      ]);
      const [next] = planRelease([input({ history: pendingPlan.nextHistory })], '1.0', S2);
      expect(next.state).toEqual({ kind: 'up-to-date' });
      expect(next.nextHistory).toBeUndefined();
    });

    it('ignores a decision for maps that are not pending', () => {
      const [plan] = planRelease([input()], '1.0.0', S3, 'overwrite');
      expect(plan.nextHistory?.versions).toEqual([
        { version: '1.0.0', registerSet: HASH_B, ...crcs(S3, '1.0.0') },
      ]);
    });
  });

  it('records the CRCs of the written version under the core scheme', () => {
    const [free] = planRelease([input()], 'alpha-1', 'free');
    expect(free.nextHistory?.versions).toEqual([
      { version: 'alpha-1', registerSet: HASH_B, ...crcs('free', 'alpha-1') },
    ]);
    const [numeric] = planRelease([input()], '1.4.2', S3);
    expect(numeric.nextHistory?.versions[0]).toMatchObject({ crc8: 0x64, crc16: 0x172a });
  });

  it('plans no write for a map that is not versioned', () => {
    const [plan] = planRelease([input({ versioned: false })], '1.0.0', S3);
    expect(plan).toEqual({ mapName: 'CSR_MAP', state: undefined });
  });

  it('plans every map of a mix, in input order', () => {
    const inputs = [
      input({ mapName: 'EMPTY' }),
      input({ mapName: 'PLAIN', versioned: false }),
      input({ mapName: 'CURRENT', history: history(['1.1.0', HASH_B]) }),
      input({ mapName: 'BUMP', history: history(['1.0.0', HASH_B]) }),
      input({ mapName: 'CHANGED', history: history(['1.0.0', HASH_A]) }),
    ];
    const plans = planRelease(inputs, '1.1.0', S3, 'adopt');
    expect(plans.map((plan) => plan.mapName)).toEqual([
      'EMPTY',
      'PLAIN',
      'CURRENT',
      'BUMP',
      'CHANGED',
    ]);
    expect(plans.map((plan) => plan.state?.kind)).toEqual([
      'empty',
      undefined,
      'up-to-date',
      'version-bump-only',
      'pending',
    ]);
    expect(plans.map((plan) => plan.nextHistory !== undefined)).toEqual([
      true,
      false,
      false,
      true,
      true,
    ]);
  });

  it('does not mutate its inputs', () => {
    const inputs = [input({ history: history(['1.0.0', HASH_A]) })];
    const before = JSON.stringify(inputs);
    planRelease(inputs, '1.0.0', S3, 'overwrite');
    planRelease(inputs, '1.1.0', S3, 'adopt');
    expect(JSON.stringify(inputs)).toBe(before);
  });
});

describe('needsDecision / pendingMaps / releaseStates', () => {
  const inputs = [
    input({ mapName: 'EMPTY' }),
    input({ mapName: 'PLAIN', versioned: false, history: history(['1.0.0', HASH_A]) }),
    input({ mapName: 'CHANGED', history: history(['1.0.0', HASH_A]) }),
  ];

  it('is true when a versioned map is pending', () => {
    expect(needsDecision(inputs, '1.1.0')).toBe(true);
    expect(pendingMaps(inputs, '1.1.0').map((map) => map.mapName)).toEqual(['CHANGED']);
  });

  it('ignores a pending map that is not versioned', () => {
    expect(needsDecision([inputs[0], inputs[1]], '1.1.0')).toBe(false);
  });

  it('is false for empty, up-to-date and version-bump-only maps', () => {
    expect(
      needsDecision(
        [
          input(),
          input({ history: history(['1.0.0', HASH_B]) }),
          input({ history: history(['0.9.0', HASH_B]) }),
        ],
        '1.0.0'
      )
    ).toBe(false);
  });

  it('reports undefined states for maps that are not versioned', () => {
    expect(releaseStates(inputs, '1.0.0').map((state) => state?.kind)).toEqual([
      'empty',
      undefined,
      'pending',
    ]);
  });

  it('reports the compared entry and whether the core version is recorded', () => {
    const [pending] = pendingMaps(inputs, '1.0.0');
    expect(pending.state.reference).toEqual({ version: '1.0.0', registerSet: HASH_A });
    expect(pending.state.coreVersionRecorded).toBe(true);
  });
});
