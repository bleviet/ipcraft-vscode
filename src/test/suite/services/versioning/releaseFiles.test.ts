import * as path from 'path';
import { normalizeMemoryMap } from '../../../../domain/parse';
import { resolveMemoryMapImports } from '../../../../services/imports/resolveMemoryMapImports';
import {
  buildMapReleases,
  describeRecorded,
  historyEdits,
  invalidCoreVersionMessage,
  readCoreReleaseInfo,
} from '../../../../services/versioning/releaseFiles';
import { planRelease } from '../../../../shared/versioning/planRelease';
import { applyPathEdits } from '../../../../yamledit';

const BASE = path.resolve('/proj/ip');

const CORE = (memoryMaps: string, version = '1.4.1') => `apiVersion: '1.2'
vlnv:
  vendor: acme
  library: lib
  name: core
  version: ${version}
  versionScheme: major.minor.patch
${memoryMaps}`;

const MAP = `# the register map
name: CSR_MAP
addressBlocks:
  - name: REGS
    offset: 0x0
    registers:
      - name: VERSION
        offset: 0
        resetValue: $version
`;

describe('readCoreReleaseInfo', () => {
  it('reads version, scheme and a shortcut import as an all-maps import', () => {
    const info = readCoreReleaseInfo(CORE('memoryMaps:\n  import: regs.mm.yml\n'), BASE);
    expect(info).toEqual({
      scheme: 'major.minor.patch',
      version: '1.4.1',
      imports: [{ absPath: path.join(BASE, 'regs.mm.yml') }],
    });
  });

  it('lists array-entry imports with their overrides and skips inline maps', () => {
    const info = readCoreReleaseInfo(
      CORE(
        'memoryMaps:\n  - import: a.mm.yml\n    name: RENAMED\n  - import: b.mm.yml\n  - name: INLINE\n    addressBlocks: []\n'
      ),
      BASE
    );
    expect(info?.imports).toEqual([
      { absPath: path.join(BASE, 'a.mm.yml'), entryOverrides: { name: 'RENAMED' } },
      { absPath: path.join(BASE, 'b.mm.yml'), entryOverrides: {} },
    ]);
  });

  it('has no imports for an inline-only core', () => {
    const info = readCoreReleaseInfo(
      CORE('memoryMaps:\n  - name: INLINE\n    addressBlocks: []\n'),
      BASE
    );
    expect(info?.imports).toEqual([]);
  });

  it('is undefined for text that is not a YAML mapping', () => {
    expect(readCoreReleaseInfo('- a\n- b\n', BASE)).toBeUndefined();
    expect(readCoreReleaseInfo('a: [\n', BASE)).toBeUndefined();
  });
});

describe('buildMapReleases', () => {
  it('builds a versioned input with hash and raw snapshot for a standalone map', () => {
    const [release] = buildMapReleases(MAP);
    expect(release.path).toEqual([]);
    expect(release.input).toMatchObject({
      mapName: 'CSR_MAP',
      history: undefined,
      versioned: true,
      snapshot: [expect.objectContaining({ name: 'REGS' })],
    });
    expect(release.input.currentHash).toMatch(/^rs1-[0-9a-f]{16}$/);
  });

  it('marks a map without history or $version refs as not versioned', () => {
    const [release] = buildMapReleases('name: PLAIN\naddressBlocks: []\n');
    expect(release.input.versioned).toBe(false);
  });

  it('returns every map of a list file for the shortcut import, and only the first for an entry', () => {
    const array = buildMapReleases(
      '- name: A\n  addressBlocks: []\n- name: B\n  addressBlocks: []\n'
    );
    expect(array.map((r) => r.path)).toEqual([[0], [1]]);
    expect(buildMapReleases('- name: A\n- name: B\n', {}).map((r) => r.input.mapName)).toEqual([
      'A',
    ]);
    expect(buildMapReleases('- name: A\n- name: B\n', {})[0].path).toEqual([0]);
  });

  it('treats a nested { memoryMaps } root as the one root map generation loads', () => {
    const text = 'memoryMaps:\n  - name: N\n    addressBlocks: []\n    versionHistory: {}\n';
    const releases = buildMapReleases(text);
    expect(releases).toHaveLength(1);
    expect(releases[0].path).toEqual([]);
    // The generator reads no addressBlocks from the root object and no versionHistory key there.
    expect(releases[0].input.versioned).toBe(false);
    expect(buildMapReleases(text, {})[0].path).toEqual([]);
  });

  it('uses the name generation uses: array-entry overrides win over the loaded map', () => {
    const [release] = buildMapReleases('name: FILE_NAME\naddressBlocks: []\n', {
      name: 'ENTRY_NAME',
    });
    expect(release.input.mapName).toBe('ENTRY_NAME');
    expect(release.path).toEqual([]);
  });

  it('matches the maps and names resolveMemoryMapImports loads', async () => {
    const files: Record<string, string> = {
      'all.mm.yml': '- name: A\n  addressBlocks: []\n- name: B\n  addressBlocks: []\n',
      'one.mm.yml': 'name: FILE\naddressBlocks: []\n',
      'nested.mm.yml': 'memoryMaps:\n  - name: N\n    addressBlocks: []\n',
    };
    const reader = { readText: async (abs: string) => files[path.basename(abs)] };
    const names = async (memoryMaps: unknown): Promise<unknown[]> =>
      (await resolveMemoryMapImports({ memoryMaps, baseDir: BASE, reader })).resolved.map(
        (map) => normalizeMemoryMap(map).name
      );
    const cases: Array<[unknown, string, Record<string, unknown> | undefined]> = [
      [{ import: 'all.mm.yml' }, 'all.mm.yml', undefined],
      [[{ import: 'all.mm.yml', name: 'X' }], 'all.mm.yml', { name: 'X' }],
      [[{ import: 'one.mm.yml', name: 'X' }], 'one.mm.yml', { name: 'X' }],
      [{ import: 'nested.mm.yml' }, 'nested.mm.yml', undefined],
      [[{ import: 'nested.mm.yml' }], 'nested.mm.yml', {}],
    ];
    for (const [memoryMaps, file, overrides] of cases) {
      expect(buildMapReleases(files[file], overrides).map((r) => r.input.mapName)).toEqual(
        await names(memoryMaps)
      );
    }
  });

  it('throws for YAML that does not parse', () => {
    expect(() => buildMapReleases('a: [\n')).toThrow();
  });
});

describe('historyEdits', () => {
  it('writes versionHistory under the map path for planned maps only, keeping comments', () => {
    const text = `${MAP}`;
    const releases = buildMapReleases(text);
    const plans = planRelease(
      releases.map((r) => r.input),
      '1.4.1'
    );
    const edits = historyEdits(releases, plans);
    expect(edits).toHaveLength(1);
    expect(edits[0].path).toEqual(['versionHistory']);

    const out = applyPathEdits(text, edits);
    expect(out).toContain('# the register map');
    expect(out).toContain('resetValue: $version');
    expect(out).toContain('versionHistory:');
    const [again] = buildMapReleases(out);
    expect(again.input.history?.versions).toEqual([
      { version: '1.4.1', registerSet: releases[0].input.currentHash },
    ]);
    // Recording the history does not change the layout hash.
    expect(again.input.currentHash).toBe(releases[0].input.currentHash);
  });

  it('addresses the right map inside an array root', () => {
    const text =
      '- name: A\n  addressBlocks: []\n- name: B\n  addressBlocks: []\n  versionHistory:\n    registerSets: {}\n    versions: []\n';
    const releases = buildMapReleases(text);
    const plans = planRelease(
      releases.map((r) => r.input),
      '1.0.0'
    );
    const edits = historyEdits(releases, plans);
    expect(edits.map((e) => e.path)).toEqual([[1, 'versionHistory']]);
    const out = applyPathEdits(text, edits);
    expect(buildMapReleases(out)[1].input.history?.versions).toHaveLength(1);
    expect(buildMapReleases(out)[0].input.history).toBeUndefined();
  });
});

describe('invalidCoreVersionMessage', () => {
  it('is undefined for a version valid in its scheme', () => {
    expect(invalidCoreVersionMessage('major.minor.patch', '1.4.1')).toBeUndefined();
    expect(invalidCoreVersionMessage('free', 'alpha')).toBeUndefined();
  });

  it('names the version and the scheme otherwise', () => {
    expect(invalidCoreVersionMessage('major.minor.patch', '1.4')).toMatch(
      /vlnv\.version '1\.4' is not valid for version scheme major\.minor\.patch/
    );
  });
});

describe('describeRecorded', () => {
  const [release] = buildMapReleases(MAP);
  const plan = planRelease([release.input], '1.4.1')[0];

  it('describes a recorded version', () => {
    expect(describeRecorded(plan, '1.4.1', undefined)).toEqual(['CSR_MAP: recorded version 1.4.1']);
  });

  it('is empty when nothing was written', () => {
    expect(describeRecorded({ mapName: 'X', state: undefined }, '1.4.1', 'adopt')).toEqual([]);
  });

  it('describes an overwrite by the version that was overwritten', () => {
    const pending = planRelease(
      [
        {
          ...release.input,
          history: {
            registerSets: { 'rs1-aaaaaaaaaaaaaaaa': { addressBlocks: [] } },
            versions: [{ version: '1.4.1', registerSet: 'rs1-aaaaaaaaaaaaaaaa' }],
          },
        },
      ],
      '1.4.1',
      'overwrite'
    )[0];
    expect(describeRecorded(pending, '1.4.1', 'overwrite')).toEqual([
      'CSR_MAP: overwrote version 1.4.1',
    ]);
  });
});
