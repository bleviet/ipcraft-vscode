import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  planRegisterSets,
  writeRegisterSets,
  type RegisterSetPolicy,
} from '../../../cli/registerSetPolicy';
import { buildMapReleases } from '../../../services/versioning/releaseFiles';
import { crc16, crc8 } from '../../../shared/versioning/versionCrc';

const core = (version: string, memoryMaps = 'memoryMaps:\n  import: regs.mm.yml\n'): string =>
  `apiVersion: '1.3'\nvlnv:\n  vendor: acme\n  library: lib\n  name: core\n  version: ${version}\n  versionScheme: major.minor.patch\n${memoryMaps}`;

const MAP = `# register map
name: CSR_MAP
addressBlocks:
  - name: REGS
    offset: 0x0
    registers:
      - name: VERSION
        offset: 0
        resetValue: $version
`;
/** Moves the VERSION register (the first occurrence, before any recorded snapshot). */
const relayout = (text: string): string =>
  text.replace(
    '        offset: 0\n        resetValue: $version\n',
    '        offset: 8\n        resetValue: $version\n'
  );

describe('register-set policy (CLI)', () => {
  let dir: string;
  let ipPath: string;
  let mmPath: string;

  const setup = (version: string, mm: string, memoryMaps?: string): void => {
    fs.writeFileSync(ipPath, core(version, memoryMaps));
    fs.writeFileSync(mmPath, mm);
  };
  const run = async (policy?: RegisterSetPolicy) => planRegisterSets(ipPath, policy);
  /** Applies the adopt policy and returns the resulting map text (records 1.4.1). */
  const released = async (): Promise<string> => {
    setup('1.4.1', MAP);
    await writeRegisterSets(await run('adopt'));
    return fs.readFileSync(mmPath, 'utf8');
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-regset-'));
    ipPath = path.join(dir, 'core.ip.yml');
    mmPath = path.join(dir, 'regs.mm.yml');
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('plans nothing when no map is versioned, with or without the flag', async () => {
    setup('1.4.1', 'name: PLAIN\naddressBlocks: []\n');
    for (const policy of [undefined, 'adopt', 'overwrite'] as const) {
      expect(await run(policy)).toEqual({ problems: [], writes: [], recorded: [] });
    }
  });

  it('plans nothing for an inline-only core and for a missing core', async () => {
    setup('1.4.1', MAP, 'memoryMaps:\n  - name: INLINE\n    addressBlocks: []\n');
    expect((await run()).problems).toEqual([]);
    expect(await planRegisterSets(path.join(dir, 'missing.ip.yml'), 'adopt')).toEqual({
      problems: [],
      writes: [],
      recorded: [],
    });
  });

  describe('without the flag', () => {
    it('reports an empty history and writes nothing', async () => {
      setup('1.4.1', MAP);
      const plan = await run();
      expect(plan.problems).toEqual([
        'CSR_MAP: no version recorded yet; re-run with --register-set-policy adopt',
      ]);
      expect(plan.writes).toEqual([]);
      expect(fs.readFileSync(mmPath, 'utf8')).toBe(MAP);
    });

    it('passes when up to date', async () => {
      await released();
      expect(await run()).toEqual({ problems: [], writes: [], recorded: [] });
    });

    it('reports an unrecorded core version', async () => {
      const recorded = await released();
      fs.writeFileSync(ipPath, core('1.4.2'));
      expect((await run()).problems).toEqual([
        'CSR_MAP: version 1.4.2 is not recorded yet; re-run with --register-set-policy adopt',
      ]);
      expect(fs.readFileSync(mmPath, 'utf8')).toBe(recorded);
    });

    it('reports a changed layout', async () => {
      await released();
      fs.writeFileSync(mmPath, relayout(fs.readFileSync(mmPath, 'utf8')));
      expect((await run()).problems).toEqual([
        'CSR_MAP: register layout changed since version 1.4.1; re-run with --register-set-policy adopt|overwrite',
      ]);
    });

    it('suggests only adopt for a changed layout when the core version is not recorded', async () => {
      await released();
      fs.writeFileSync(ipPath, core('1.4.2'));
      fs.writeFileSync(mmPath, relayout(fs.readFileSync(mmPath, 'utf8')));
      expect((await run()).problems).toEqual([
        'CSR_MAP: register layout changed since version 1.4.1; re-run with --register-set-policy adopt',
      ]);
    });
  });

  describe('with a policy', () => {
    it('adopt records an empty history and a version bump', async () => {
      const recorded = await released();
      expect(buildMapReleases(recorded)[0].input.history?.versions).toEqual([
        {
          version: '1.4.1',
          registerSet: expect.any(String),
          crc8: crc8([1, 4, 1]),
          crc16: crc16([1, 4, 1]),
        },
      ]);
      expect(recorded).toContain('# register map');

      fs.writeFileSync(ipPath, core('1.4.2'));
      const plan = await run('adopt');
      expect(plan.recorded).toEqual(['CSR_MAP: recorded version 1.4.2']);
      expect(plan.writes).toHaveLength(1);
      expect(plan.writes[0].filePath).toBe(mmPath);
      expect(fs.readFileSync(mmPath, 'utf8')).toBe(recorded);
    });

    it('overwrite appends non-pending states like adopt', async () => {
      setup('1.4.1', MAP);
      expect((await run('overwrite')).recorded).toEqual(['CSR_MAP: recorded version 1.4.1']);
    });

    it('adopt on a changed layout appends the unrecorded core version', async () => {
      await released();
      fs.writeFileSync(ipPath, core('1.4.2'));
      fs.writeFileSync(mmPath, relayout(fs.readFileSync(mmPath, 'utf8')));
      const plan = await run('adopt');
      await writeRegisterSets(plan);
      const history = buildMapReleases(fs.readFileSync(mmPath, 'utf8'))[0].input.history;
      expect(history?.versions.map((v) => v.version)).toEqual(['1.4.1', '1.4.2']);
      expect(Object.keys(history?.registerSets ?? {})).toHaveLength(2);
    });

    it('adopt fails when the core version is already recorded for a changed layout', async () => {
      await released();
      fs.writeFileSync(mmPath, relayout(fs.readFileSync(mmPath, 'utf8')));
      const plan = await run('adopt');
      expect(plan.problems).toEqual([
        'CSR_MAP: version 1.4.1 is already recorded; bump vlnv.version or use --register-set-policy overwrite',
      ]);
      expect(plan.writes).toEqual([]);
    });

    it('overwrite replaces the layout of the core version when it is recorded', async () => {
      await released();
      fs.writeFileSync(mmPath, relayout(fs.readFileSync(mmPath, 'utf8')));
      const plan = await run('overwrite');
      expect(plan.recorded).toEqual(['CSR_MAP: overwrote version 1.4.1']);
      await writeRegisterSets(plan);
      const history = buildMapReleases(fs.readFileSync(mmPath, 'utf8'))[0].input.history;
      expect(history?.versions.map((v) => v.version)).toEqual(['1.4.1']);
      expect(Object.keys(history?.registerSets ?? {})).toHaveLength(1);
      expect(await run()).toEqual({ problems: [], writes: [], recorded: [] });
    });

    it('overwrite re-points the core version entry, not the latest (audit scenario)', async () => {
      // 1.4.1 -> layout A, 1.4.2 -> layout B; the core is back at 1.4.1 with layout C.
      const recorded = await released();
      fs.writeFileSync(ipPath, core('1.4.2'));
      fs.writeFileSync(mmPath, relayout(recorded));
      await writeRegisterSets(await run('adopt'));
      const before = buildMapReleases(fs.readFileSync(mmPath, 'utf8'))[0].input.history;
      fs.writeFileSync(ipPath, core('1.4.1'));
      fs.writeFileSync(
        mmPath,
        fs
          .readFileSync(mmPath, 'utf8')
          .replace('offset: 8\n        resetValue', 'offset: 12\n        resetValue')
      );

      const plan = await run('overwrite');
      expect(plan.problems).toEqual([]);
      await writeRegisterSets(plan);
      const after = buildMapReleases(fs.readFileSync(mmPath, 'utf8'))[0];
      expect(after.input.history?.versions.map((v) => v.version)).toEqual(['1.4.1', '1.4.2']);
      const [first, second] = after.input.history?.versions ?? [];
      expect(first.registerSet).toBe(after.input.currentHash);
      expect(second).toEqual(before?.versions[1]);
    });

    it('overwrite fails when the core version is not recorded for a changed layout', async () => {
      await released();
      fs.writeFileSync(ipPath, core('1.4.2'));
      fs.writeFileSync(mmPath, relayout(fs.readFileSync(mmPath, 'utf8')));
      const plan = await run('overwrite');
      expect(plan.problems).toEqual([
        'CSR_MAP: version 1.4.2 is not recorded; use --register-set-policy adopt',
      ]);
      expect(plan.writes).toEqual([]);
    });

    it('does not write until writeRegisterSets is called', async () => {
      setup('1.4.1', MAP);
      await run('adopt');
      expect(fs.readFileSync(mmPath, 'utf8')).toBe(MAP);
    });
  });

  describe('invalid core version', () => {
    it.each([undefined, 'adopt', 'overwrite'] as const)(
      'fails without writing for policy %s',
      async (policy) => {
        // No live `$version` reference, so the gate does not report the version itself.
        const recorded = (await released()).replace('resetValue: $version\n', 'resetValue: 0\n');
        setup('1.x', recorded);
        const plan = await run(policy);
        expect(plan.problems).toEqual([
          expect.stringMatching(
            /^CSR_MAP: vlnv\.version '1\.x' is not valid for version scheme major\.minor\.patch/
          ),
        ]);
        expect(plan.writes).toEqual([]);
      }
    );
  });

  it('leaves an invalid core version with a `$version` reference to the gate', async () => {
    setup('1.x', MAP);
    expect(await run('adopt')).toEqual({ problems: [], writes: [], recorded: [] });
  });

  describe('$version gate', () => {
    /** `$version.feature` does not exist in major.minor.patch: a gate error generation reports. */
    const gated = (text: string): string =>
      text.replace('resetValue: $version\n', 'resetValue: $version.feature\n');

    it.each([
      ['adopt', '1.4.2'],
      ['overwrite', '1.4.1'],
    ] as const)(
      'plans no write for policy %s while generation is blocked by gate errors',
      async (policy, version) => {
        const recorded = await released();
        const changed = gated(recorded).replace(
          'resetValue: $version.feature\n',
          'resetValue: $version.feature\n      - name: EXTRA\n        offset: 4\n'
        );
        setup(version, changed);
        expect(await run(policy)).toEqual({ problems: [], writes: [], recorded: [] });
        expect(fs.readFileSync(mmPath, 'utf8')).toBe(changed);
      }
    );

    it('plans no initial history for a map the gate blocks', async () => {
      setup('1.4.1', gated(MAP));
      expect(await run('adopt')).toEqual({ problems: [], writes: [], recorded: [] });
    });

    it.each([undefined, 'adopt'] as const)(
      'reports no register-set problem for a map the gate blocks (policy %s): generation reports the gate',
      async (policy) => {
        setup('1.4.1', gated(MAP));
        expect(await run(policy)).toEqual({ problems: [], writes: [], recorded: [] });
      }
    );

    it('checks the gate before a changed layout, so no unhelpful flag is suggested', async () => {
      const recorded = await released();
      const changed = gated(recorded).replace(
        'resetValue: $version.feature\n',
        'resetValue: $version.feature\n      - name: EXTRA\n        offset: 4\n'
      );
      setup('1.4.2', changed);
      expect(await run()).toEqual({ problems: [], writes: [], recorded: [] });
      expect(fs.readFileSync(mmPath, 'utf8')).toBe(changed);
    });

    it('still plans the write when the gate only has warnings (a moved version register)', async () => {
      const moved = relayout(await released());
      setup('1.4.2', moved);
      const plan = await run('adopt');
      expect(plan.problems).toEqual([]);
      expect(plan.writes.map((w) => w.filePath)).toEqual([mmPath]);
      expect(plan.recorded).toEqual(['CSR_MAP: recorded version 1.4.2']);
    });
  });

  it('versions the map name generation uses for an array-entry import with an override', async () => {
    setup('1.4.1', MAP, 'memoryMaps:\n  - import: regs.mm.yml\n    name: RENAMED\n');
    const plan = await run();
    expect(plan.problems).toEqual([
      'RENAMED: no version recorded yet; re-run with --register-set-policy adopt',
    ]);
  });

  it('plans one write per file for several imported maps', async () => {
    const second = path.join(dir, 'second.mm.yml');
    setup('1.4.1', MAP, 'memoryMaps:\n  - import: regs.mm.yml\n  - import: second.mm.yml\n');
    fs.writeFileSync(second, MAP.replace('CSR_MAP', 'SECOND_MAP'));
    const plan = await run('adopt');
    expect(plan.writes.map((w) => w.filePath)).toEqual([mmPath, second]);
    expect(plan.recorded).toEqual([
      'CSR_MAP: recorded version 1.4.1',
      'SECOND_MAP: recorded version 1.4.1',
    ]);
  });
});
