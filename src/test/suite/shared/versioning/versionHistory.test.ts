import jsyaml from 'js-yaml';
import { normalizeMemoryMap, parseMemoryMap } from '../../../../domain/parse';
import type { NormalizedAddressBlock } from '../../../../domain/internal.types';
import { hashRegisterSet } from '../../../../shared/versioning/registerSetHash';
import { crc16, crc8 } from '../../../../shared/versioning/versionCrc';
import type { VersionScheme } from '../../../../shared/versioning/versionScheme';
import {
  appendVersion,
  findVersionRegisters,
  overwriteVersion,
  releaseState,
  versionRegisterChanges,
  type VersionHistory,
} from '../../../../shared/versioning/versionHistory';

const HASH_A = 'rs1-aaaaaaaaaaaaaaaa';
const HASH_B = 'rs1-bbbbbbbbbbbbbbbb';
const HASH_C = 'rs1-cccccccccccccccc';
const S3: VersionScheme = 'major.minor.patch';

const history = (...entries: Array<[string, string]>): VersionHistory => ({
  registerSets: Object.fromEntries(
    [...new Set(entries.map(([, hash]) => hash))].map((hash) => [
      hash,
      { addressBlocks: [{ name: `snap-${hash}` }] },
    ])
  ),
  versions: entries.map(([version, registerSet]) => ({ version, registerSet })),
});

describe('releaseState', () => {
  it('is empty without history', () => {
    expect(releaseState(undefined, HASH_A, '1.0.0')).toEqual({ kind: 'empty' });
  });

  it('is empty with no versions', () => {
    expect(releaseState({ registerSets: {}, versions: [] }, HASH_A, '1.0.0')).toEqual({
      kind: 'empty',
    });
  });

  it('is up-to-date when the hash matches and the core version is recorded', () => {
    expect(releaseState(history(['1.0.0', HASH_A]), HASH_A, '1.0.0')).toEqual({
      kind: 'up-to-date',
    });
  });

  it('is up-to-date when the core version is recorded on an older entry', () => {
    const h = history(['1.0.0', HASH_A], ['1.1.0', HASH_A]);
    expect(releaseState(h, HASH_A, '1.0.0')).toEqual({ kind: 'up-to-date' });
  });

  it('is version-bump-only when the hash matches but the core version is new', () => {
    expect(releaseState(history(['1.0.0', HASH_A]), HASH_A, '1.0.1')).toEqual({
      kind: 'version-bump-only',
    });
  });

  it('is pending when the hash differs and the core version is new', () => {
    const h = history(['1.0.0', HASH_A]);
    expect(releaseState(h, HASH_B, '1.1.0')).toEqual({
      kind: 'pending',
      reference: { version: '1.0.0', registerSet: HASH_A },
      currentHash: HASH_B,
      coreVersionRecorded: false,
    });
  });

  it('is pending with coreVersionRecorded when the core version is already recorded', () => {
    const h = history(['1.0.0', HASH_A]);
    expect(releaseState(h, HASH_B, '1.0.0')).toEqual({
      kind: 'pending',
      reference: { version: '1.0.0', registerSet: HASH_A },
      currentHash: HASH_B,
      coreVersionRecorded: true,
    });
  });

  it('compares with the core version entry, not the latest one', () => {
    const h = history(['1.0', HASH_A], ['1.1', HASH_B]);
    expect(releaseState(h, HASH_C, '1.0')).toEqual({
      kind: 'pending',
      reference: { version: '1.0', registerSet: HASH_A },
      currentHash: HASH_C,
      coreVersionRecorded: true,
    });
  });

  it('is up-to-date for a recorded core version whose hash matches while the latest differs', () => {
    const h = history(['1.0', HASH_A], ['1.1', HASH_B]);
    expect(releaseState(h, HASH_A, '1.0')).toEqual({ kind: 'up-to-date' });
  });

  it('is version-bump-only when the core version is unrecorded and the hash equals the latest', () => {
    const h = history(['1.0', HASH_A], ['1.1', HASH_B]);
    expect(releaseState(h, HASH_B, '1.2')).toEqual({ kind: 'version-bump-only' });
  });

  it('is pending against the latest when the core version is unrecorded and the hash differs', () => {
    const h = history(['1.0', HASH_A], ['1.1', HASH_B]);
    expect(releaseState(h, HASH_C, '1.2')).toEqual({
      kind: 'pending',
      reference: { version: '1.1', registerSet: HASH_B },
      currentHash: HASH_C,
      coreVersionRecorded: false,
    });
  });

  it('takes the latest from list order, not from version ordering', () => {
    const h = history(['2.0', HASH_A], ['1.5', HASH_B]);
    // Unrecorded core version: the latest is the last entry (1.5 -> B).
    expect(releaseState(h, HASH_B, '3.0')).toEqual({ kind: 'version-bump-only' });
    expect(releaseState(h, HASH_A, '3.0')).toMatchObject({
      kind: 'pending',
      reference: { version: '1.5', registerSet: HASH_B },
      coreVersionRecorded: false,
    });
  });

  it('works for free-text versions', () => {
    const h = history(['alpha', HASH_A]);
    expect(releaseState(h, HASH_A, 'alpha')).toEqual({ kind: 'up-to-date' });
    expect(releaseState(h, HASH_A, 'beta')).toEqual({ kind: 'version-bump-only' });
  });
});

describe('appendVersion', () => {
  const snapshot = [{ name: 'B' }];

  it('creates the history when undefined', () => {
    expect(appendVersion(undefined, '1.0.0', S3, HASH_A, snapshot)).toEqual({
      registerSets: { [HASH_A]: { addressBlocks: snapshot } },
      versions: [
        { version: '1.0.0', registerSet: HASH_A, crc8: crc8([1, 0, 0]), crc16: crc16([1, 0, 0]) },
      ],
    });
  });

  it('appends at the end and stores the new snapshot', () => {
    const next = appendVersion(history(['1.0.0', HASH_A]), '1.1.0', S3, HASH_B, snapshot);
    expect(next.versions).toEqual([
      { version: '1.0.0', registerSet: HASH_A },
      { version: '1.1.0', registerSet: HASH_B, crc8: crc8([1, 1, 0]), crc16: crc16([1, 1, 0]) },
    ]);
    expect(Object.keys(next.registerSets)).toEqual([HASH_A, HASH_B]);
    expect(next.registerSets[HASH_B]).toEqual({ addressBlocks: snapshot });
  });

  it('shares an existing set between identical layouts instead of overwriting it', () => {
    const base = history(['1.0.0', HASH_A]);
    const original = base.registerSets[HASH_A];
    const next = appendVersion(base, '1.0.1', S3, HASH_A, [{ name: 'different' }]);
    expect(next.versions.map((v) => v.registerSet)).toEqual([HASH_A, HASH_A]);
    expect(Object.keys(next.registerSets)).toEqual([HASH_A]);
    expect(next.registerSets[HASH_A]).toBe(original);
  });

  it('records no CRCs for a version that is invalid under the scheme', () => {
    const next = appendVersion(undefined, 'abc', S3, HASH_A, snapshot);
    expect(next.versions).toEqual([{ version: 'abc', registerSet: HASH_A }]);
  });

  it('records the CRCs of free text', () => {
    const next = appendVersion(undefined, ' v1 ', 'free', HASH_A, snapshot);
    expect(next.versions[0]).toMatchObject({
      crc8: crc8([0x76, 0x31]),
      crc16: crc16([0x76, 0x31]),
    });
  });

  it('throws when the version is already recorded', () => {
    expect(() => appendVersion(history(['1.0.0', HASH_A]), '1.0.0', S3, HASH_B, snapshot)).toThrow(
      /1\.0\.0.*already recorded/
    );
  });

  it('does not mutate its input and returns a new object', () => {
    const base = history(['1.0.0', HASH_A]);
    const copy = JSON.parse(JSON.stringify(base)) as VersionHistory;
    const next = appendVersion(base, '1.1.0', S3, HASH_B, snapshot);
    expect(base).toEqual(copy);
    expect(next).not.toBe(base);
    expect(next.versions).not.toBe(base.versions);
    expect(next.registerSets).not.toBe(base.registerSets);
  });

  it('returns new containers even when nothing new is stored', () => {
    const base = history(['1.0.0', HASH_A]);
    const next = appendVersion(base, '1.0.1', S3, HASH_A, snapshot);
    expect(next.registerSets).not.toBe(base.registerSets);
    expect(base.versions).toHaveLength(1);
  });
});

describe('overwriteVersion', () => {
  const snapshot = [{ name: 'NEW' }];

  it('throws when the version is not recorded', () => {
    expect(() =>
      overwriteVersion({ registerSets: {}, versions: [] }, '1.0.0', S3, HASH_A, snapshot)
    ).toThrow(/1\.0\.0.*not recorded/);
    expect(() =>
      overwriteVersion(history(['1.0.0', HASH_A]), '1.1.0', S3, HASH_B, snapshot)
    ).toThrow(/1\.1\.0.*not recorded/);
  });

  it('re-points only the named entry and stores the snapshot', () => {
    const next = overwriteVersion(
      history(['1.0.0', HASH_A], ['1.1.0', HASH_B]),
      '1.1.0',
      S3,
      HASH_C,
      snapshot
    );
    expect(next.versions).toEqual([
      { version: '1.0.0', registerSet: HASH_A },
      { version: '1.1.0', registerSet: HASH_C, crc8: crc8([1, 1, 0]), crc16: crc16([1, 1, 0]) },
    ]);
    expect(next.registerSets[HASH_C]).toEqual({ addressBlocks: snapshot });
  });

  it('re-points an entry that is not the latest and leaves the latest alone', () => {
    const next = overwriteVersion(
      history(['1.0.0', HASH_A], ['1.1.0', HASH_B]),
      '1.0.0',
      S3,
      HASH_C,
      snapshot
    );
    expect(next.versions).toEqual([
      { version: '1.0.0', registerSet: HASH_C, crc8: crc8([1, 0, 0]), crc16: crc16([1, 0, 0]) },
      { version: '1.1.0', registerSet: HASH_B },
    ]);
    expect(Object.keys(next.registerSets).sort()).toEqual([HASH_B, HASH_C]);
  });

  it('drops the replaced set when no other entry references it', () => {
    const next = overwriteVersion(
      history(['1.0.0', HASH_A], ['1.1.0', HASH_B]),
      '1.1.0',
      S3,
      HASH_C,
      snapshot
    );
    expect(Object.keys(next.registerSets).sort()).toEqual([HASH_A, HASH_C]);
  });

  it('keeps the replaced set when another entry still references it', () => {
    const next = overwriteVersion(
      history(['1.0.0', HASH_A], ['1.1.0', HASH_A]),
      '1.1.0',
      S3,
      HASH_C,
      snapshot
    );
    expect(Object.keys(next.registerSets).sort()).toEqual([HASH_A, HASH_C]);
  });

  it('replaces the CRCs of the overwritten entry only', () => {
    const old = { version: '1.0.0', registerSet: HASH_A, crc8: 1, crc16: 2 };
    const h: VersionHistory = {
      registerSets: { [HASH_A]: { addressBlocks: [] } },
      versions: [old, { version: '1.1.0', registerSet: HASH_A, crc8: 3, crc16: 4 }],
    };
    const next = overwriteVersion(h, '1.0.0', S3, HASH_C, snapshot);
    expect(next.versions[0]).toEqual({
      version: '1.0.0',
      registerSet: HASH_C,
      crc8: crc8([1, 0, 0]),
      crc16: crc16([1, 0, 0]),
    });
    expect(next.versions[1]).toEqual({ version: '1.1.0', registerSet: HASH_A, crc8: 3, crc16: 4 });
  });

  it('removes every unreferenced set, including ones that were already orphaned', () => {
    const h = history(['1.0.0', HASH_A]);
    h.registerSets[HASH_B] = { addressBlocks: [] };
    const next = overwriteVersion(h, '1.0.0', S3, HASH_C, snapshot);
    expect(Object.keys(next.registerSets)).toEqual([HASH_C]);
  });

  it('keeps the stored snapshot when re-pointed at the hash it already has', () => {
    const next = overwriteVersion(history(['1.0.0', HASH_A]), '1.0.0', S3, HASH_A, snapshot);
    expect(Object.keys(next.registerSets)).toEqual([HASH_A]);
    expect(next.registerSets[HASH_A]).toEqual({ addressBlocks: [{ name: `snap-${HASH_A}` }] });
  });

  it('keeps the stored snapshot of an existing set that backs other versions', () => {
    const next = overwriteVersion(
      history(['1.0.0', HASH_A], ['1.1.0', HASH_B]),
      '1.1.0',
      S3,
      HASH_A,
      snapshot
    );
    expect(next.versions.map((entry) => entry.registerSet)).toEqual([HASH_A, HASH_A]);
    expect(next.registerSets[HASH_A]).toEqual({ addressBlocks: [{ name: `snap-${HASH_A}` }] });
    expect(Object.keys(next.registerSets)).toEqual([HASH_A]);
  });

  it('does not mutate its input', () => {
    const base = history(['1.0.0', HASH_A], ['1.1.0', HASH_B]);
    const copy = JSON.parse(JSON.stringify(base)) as VersionHistory;
    const next = overwriteVersion(base, '1.1.0', S3, HASH_C, snapshot);
    expect(base).toEqual(copy);
    expect(next).not.toBe(base);
    expect(next.versions).not.toBe(base.versions);
  });
});

function blocksOf(text: string): NormalizedAddressBlock[] {
  return parseMemoryMap(text).map.addressBlocks;
}

function rawBlocksOf(text: string): unknown[] {
  // The raw snapshot as it would be stored: the YAML objects, tokens kept symbolic.
  const parsed = jsyaml.load(text) as Array<{ addressBlocks: unknown[] }>;
  return parsed[0].addressBlocks;
}

const parseSnapshot = (blocks: unknown[]): NormalizedAddressBlock[] =>
  normalizeMemoryMap({ addressBlocks: blocks }).addressBlocks;

const withVersionRegister = (opts: {
  base?: number;
  offset?: number;
  majorBits?: string;
  minorBits?: string;
  minorRef?: string;
  extra?: string;
  registerName?: string;
}): string => `
- name: CSR
  addressBlocks:
    - name: REGS
      baseAddress: ${opts.base ?? 0x1000}
      registers:
        - name: ${opts.registerName ?? 'VERSION'}
          offset: ${opts.offset ?? 0}
          fields:
            - { name: MAJOR, bits: "${opts.majorBits ?? '[23:16]'}", resetValue: $version.major }
            - { name: MINOR, bits: "${opts.minorBits ?? '[15:8]'}", resetValue: ${opts.minorRef ?? '$version.minor'} }
            - { name: FLAGS, bits: "[7:0]", resetValue: 5 }
        - name: CTRL
          offset: 4
${opts.extra ?? ''}`;

describe('findVersionRegisters', () => {
  it('detects field refs with absolute address and field layout', () => {
    const found = findVersionRegisters(blocksOf(withVersionRegister({ offset: 8 })));
    expect(found).toEqual([
      {
        blockName: 'REGS',
        registerName: 'VERSION',
        address: 0x1008,
        fields: [
          { name: 'MAJOR', offset: 16, width: 8, ref: '$version.major' },
          { name: 'MINOR', offset: 8, width: 8, ref: '$version.minor' },
        ],
      },
    ]);
    expect(found[0]).not.toHaveProperty('registerRef');
  });

  it('detects a register-level ref', () => {
    const text = `
- name: CSR
  addressBlocks:
    - name: B
      baseAddress: 0x100
      registers:
        - { name: V, offset: 0x10, resetValue: $version }
        - { name: PLAIN, offset: 0x14, resetValue: 7 }
`;
    expect(findVersionRegisters(blocksOf(text))).toEqual([
      {
        blockName: 'B',
        registerName: 'V',
        address: 0x110,
        fields: [],
        registerRef: '$version',
      },
    ]);
  });

  it('reports both a register ref and field refs on the same register', () => {
    const text = `
- name: CSR
  addressBlocks:
    - name: B
      registers:
        - name: V
          resetValue: $version
          fields:
            - { name: MAJOR, bits: "[7:0]", resetValue: $version.major }
`;
    const [info] = findVersionRegisters(blocksOf(text));
    expect(info.registerRef).toBe('$version');
    expect(info.fields).toHaveLength(1);
  });

  it('finds nothing without refs', () => {
    expect(findVersionRegisters(blocksOf('- name: X\n  addressBlocks:\n    - name: B\n'))).toEqual(
      []
    );
  });

  it('ignores register arrays, even when a ref sits inside one', () => {
    const text = `
- name: CSR
  addressBlocks:
    - name: B
      registers:
        - name: ARR
          offset: 0
          count: 2
          stride: 8
          registers:
            - { name: V, offset: 0, resetValue: $version }
`;
    expect(findVersionRegisters(blocksOf(text))).toEqual([]);
  });
});

describe('versionRegisterChanges', () => {
  const current = (text: string) => blocksOf(text);
  const recordedWith = (text: string, hash = HASH_A): VersionHistory => ({
    registerSets: { [hash]: { addressBlocks: rawBlocksOf(text) } },
    versions: [{ version: '1.0.0', registerSet: hash }],
  });

  it('reports nothing when the version register is unchanged', () => {
    const text = withVersionRegister({});
    expect(versionRegisterChanges(recordedWith(text), current(text), parseSnapshot)).toEqual([]);
  });

  it('ignores changes unrelated to the version register', () => {
    const recorded = withVersionRegister({});
    const now = withVersionRegister({ extra: '          resetValue: 9\n' });
    expect(versionRegisterChanges(recordedWith(recorded), current(now), parseSnapshot)).toEqual([]);
  });

  it('reports an address change (register offset)', () => {
    const changes = versionRegisterChanges(
      recordedWith(withVersionRegister({})),
      current(withVersionRegister({ offset: 0x20 })),
      parseSnapshot
    );
    expect(changes).toEqual([
      expect.objectContaining({
        version: '1.0.0',
        kind: 'address',
        detail: expect.stringContaining('0x1000'),
      }),
    ]);
    expect(changes[0].detail).toContain('0x1020');
    expect(changes[0].detail).toContain('REGS.VERSION');
  });

  it('reports an address change (block base address)', () => {
    const changes = versionRegisterChanges(
      recordedWith(withVersionRegister({})),
      current(withVersionRegister({ base: 0x2000 })),
      parseSnapshot
    );
    expect(changes.map((c) => c.kind)).toEqual(['address']);
  });

  it('reports a layout change (field bits)', () => {
    const changes = versionRegisterChanges(
      recordedWith(withVersionRegister({})),
      current(withVersionRegister({ majorBits: '[31:24]' })),
      parseSnapshot
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ version: '1.0.0', kind: 'layout' });
    expect(changes[0].detail).toContain('MAJOR');
  });

  it('reports a layout change (field ref)', () => {
    const changes = versionRegisterChanges(
      recordedWith(withVersionRegister({})),
      current(withVersionRegister({ minorRef: '$version.patch' })),
      parseSnapshot
    );
    expect(changes.map((c) => c.kind)).toEqual(['layout']);
    expect(changes[0].detail).toContain('$version.patch');
  });

  it('reports address and layout separately when both changed', () => {
    const changes = versionRegisterChanges(
      recordedWith(withVersionRegister({})),
      current(withVersionRegister({ offset: 4, minorBits: '[11:4]' })),
      parseSnapshot
    );
    expect(changes.map((c) => c.kind)).toEqual(['address', 'layout']);
  });

  it('reports a version register that is missing from the current set', () => {
    const changes = versionRegisterChanges(
      recordedWith(withVersionRegister({})),
      current(
        '- name: CSR\n  addressBlocks:\n    - name: REGS\n      registers:\n        - { name: CTRL, offset: 0 }\n'
      ),
      parseSnapshot
    );
    expect(changes).toEqual([
      { version: '1.0.0', kind: 'missing', detail: expect.stringContaining('REGS.VERSION') },
    ]);
  });

  it('reports a renamed version register as missing plus added', () => {
    const changes = versionRegisterChanges(
      recordedWith(withVersionRegister({})),
      current(withVersionRegister({ registerName: 'IP_VERSION' })),
      parseSnapshot
    );
    expect(changes.map((c) => c.kind).sort()).toEqual(['added', 'missing']);
  });

  it('reports a version register the recorded set did not have as added', () => {
    const changes = versionRegisterChanges(
      recordedWith(
        '- name: CSR\n  addressBlocks:\n    - name: REGS\n      baseAddress: 0x1000\n      registers:\n        - { name: CTRL, offset: 0 }\n'
      ),
      current(withVersionRegister({})),
      parseSnapshot
    );
    expect(changes).toEqual([
      { version: '1.0.0', kind: 'added', detail: expect.stringContaining('REGS.VERSION') },
    ]);
  });

  it('compares each distinct recorded set once, naming the earliest version using it', () => {
    const recorded = withVersionRegister({});
    const moved = withVersionRegister({ offset: 0x40 });
    const h: VersionHistory = {
      registerSets: {
        [HASH_A]: { addressBlocks: rawBlocksOf(recorded) },
        [HASH_B]: { addressBlocks: rawBlocksOf(moved) },
      },
      versions: [
        { version: '1.0.0', registerSet: HASH_A },
        { version: '1.0.1', registerSet: HASH_A },
        { version: '1.1.0', registerSet: HASH_B },
      ],
    };
    const changes = versionRegisterChanges(
      h,
      current(withVersionRegister({ offset: 0x40 })),
      parseSnapshot
    );
    expect(changes).toEqual([expect.objectContaining({ version: '1.0.0', kind: 'address' })]);
  });

  it('skips entries whose snapshot is missing', () => {
    const h: VersionHistory = {
      registerSets: {},
      versions: [{ version: '1.0.0', registerSet: HASH_A }],
    };
    expect(versionRegisterChanges(h, current(withVersionRegister({})), parseSnapshot)).toEqual([]);
  });

  it('reads recorded snapshots as raw schema objects (symbolic tokens)', () => {
    const text = withVersionRegister({});
    const hash = hashRegisterSet(blocksOf(text));
    const h = appendVersion(undefined, '1.0.0', S3, hash, rawBlocksOf(text));
    expect(versionRegisterChanges(h, current(text), parseSnapshot)).toEqual([]);
  });
});
