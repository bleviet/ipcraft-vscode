/** @jest-environment node */
// Runs `ipcraft diff` end to end on files and on a temporary git repository.
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Finding, FindingsDiff, SystemGraphDiff } from '../../../domain/systemGraphDiff';
import { failOnReason, runCliDiff } from '../../../cli/diff';
import { main } from '../../../cli/index';

const fixtures = path.resolve(__dirname, '../../fixtures/system-design/diff');
const BASE = path.join(fixtures, 'zynq_gpio_base.bd');
const CURRENT = path.join(fixtures, 'zynq_gpio_current.bd');
const golden = (file: string) => fs.readFileSync(path.join(fixtures, file), 'utf8');
const GOLDEN_LABELS = 'Comparing `HEAD` (base) with `working tree`.';
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const gitAvailable = spawnSync('git', ['--version']).status === 0;

let tmp: string;

// Git must see neither the global or system configuration nor a repository around the temp dir.
const GIT_ENV = ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_NOSYSTEM', 'GIT_CEILING_DIRECTORIES'] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-diff-')));
  for (const key of GIT_ENV) {
    savedEnv[key] = process.env[key];
  }
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_NOSYSTEM = '1';
  process.env.GIT_CEILING_DIRECTORIES = tmp;
});

afterAll(() => {
  for (const key of GIT_ENV) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

const files = (extra: Partial<Parameters<typeof runCliDiff>[0]> = {}) => ({
  files: [BASE, CURRENT],
  format: 'markdown' as const,
  ignoreVersionOnly: false,
  ...extra,
});

describe('ipcraft diff of two files', () => {
  it('writes the Markdown report to --out, labelled with the two paths', async () => {
    const out = path.join(tmp, 'nested', 'report.md');
    const result = await runCliDiff(files({ out }));
    expect(result).toEqual({ success: true, outputPath: out });
    expect(fs.readFileSync(out, 'utf8')).toBe(
      golden('zynq_gpio.expected.md').replace(
        GOLDEN_LABELS,
        `Comparing \`${BASE}\` (base) with \`${CURRENT}\`.`
      )
    );
  });

  it('returns the report when there is no --out', async () => {
    const result = await runCliDiff(files());
    expect(result.success).toBe(true);
    expect(result.report).toContain('## System design changes: zynq_gpio_system');
  });

  it('writes the JSON report with a trailing newline', async () => {
    const out = path.join(tmp, 'report.json');
    await runCliDiff(files({ out, format: 'json' }));
    const text = fs.readFileSync(out, 'utf8');
    expect(text.endsWith('}\n')).toBe(true);
    const diff = JSON.parse(text);
    expect(diff.summary).toEqual({ added: 1, removed: 4, changed: 2, version: 1, renamed: 0 });
    expect(text).toBe(`${JSON.stringify(diff, null, 2)}\n`);
  });

  it('writes the findings that differ in the JSON, and an empty list for none', async () => {
    const json = JSON.parse((await runCliDiff(files({ format: 'json' }))).report as string);
    expect(json.findings).toEqual({
      new: [],
      resolved: [{ kind: 'undriven', level: '/', instance: null, pin: 'led_o', label: 'led_o' }],
    });
    const renamePair = {
      files: [
        path.join(fixtures, 'zynq_gpio_rename_base.bd'),
        path.join(fixtures, 'zynq_gpio_rename_current.bd'),
      ],
      format: 'json' as const,
    };
    const none = JSON.parse((await runCliDiff(files(renamePair))).report as string);
    expect(none.findings).toEqual({ new: [], resolved: [] });
  });

  it('keeps the findings with --ignore-version-only', async () => {
    const result = await runCliDiff(files({ format: 'json', ignoreVersionOnly: true }));
    expect(JSON.parse(result.report as string).findings.resolved).toHaveLength(1);
  });

  it('writes the Findings section in the Markdown when the findings differ', async () => {
    const markdown = (await runCliDiff(files())).report as string;
    expect(markdown).toContain('1 resolved finding**\n\n### Findings\n');
    expect(markdown).toContain('| Resolved | undriven pin | `led_o` | |');
  });

  it('reports a renamed block in the JSON with its base path, and as one row in the Markdown', async () => {
    const pair = {
      files: [
        path.join(fixtures, 'zynq_gpio_rename_base.bd'),
        path.join(fixtures, 'zynq_gpio_rename_current.bd'),
      ],
    };
    const json = JSON.parse(
      (await runCliDiff(files({ ...pair, format: 'json' }))).report as string
    ) as SystemGraphDiff;
    expect(json.summary).toEqual({ added: 0, removed: 0, changed: 1, version: 0, renamed: 1 });
    expect(json.instances.find((i) => i.status === 'renamed')).toMatchObject({
      path: '/axi_gpio_main',
      basePath: '/axi_gpio_0',
      level: '/',
      parameters: [],
      pins: [],
    });
    const markdown = (await runCliDiff(files(pair))).report as string;
    expect(markdown).toContain('| → | `axi_gpio_main` | renamed | `axi_gpio_`**`0`** |');
  });

  it('leaves version-only instances out of the JSON with --ignore-version-only', async () => {
    const result = await runCliDiff(files({ format: 'json', ignoreVersionOnly: true }));
    const diff = JSON.parse(result.report as string) as SystemGraphDiff;
    expect(diff.summary.version).toBe(0);
    expect(diff.instances.some((i) => i.status === 'version')).toBe(false);
  });

  it('fails for a file that is not a system design', async () => {
    const other = path.join(tmp, 'other.bd');
    fs.writeFileSync(other, '{}');
    expect(await runCliDiff(files({ files: [BASE, other] }))).toEqual({
      success: false,
      error: `'${other}' is not a recognized system design`,
    });
  });

  it('fails for a file that does not exist', async () => {
    const missing = path.join(tmp, 'missing.bd');
    const result = await runCliDiff(files({ files: [missing, CURRENT] }));
    expect(result).toEqual({ success: false, error: `Input file not found: ${missing}` });
  });
});

describe('ipcraft diff command', () => {
  it('prints the report to standard output and exits with 0', async () => {
    const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(await main(['diff', BASE, CURRENT])).toBe(0);
    expect(String(write.mock.calls[0][0])).toContain('### Address map');
    write.mockRestore();
  });

  it('exits with 1 and names the problem on an error', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(await main(['diff', BASE, path.join(tmp, 'gone.bd')])).toBe(1);
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Diff failed: Input file not found')
      );
    } finally {
      error.mockRestore();
    }
  });
});

describe('ipcraft diff --fail-on', () => {
  const finding: Finding = {
    kind: 'undriven',
    level: '/',
    instance: null,
    pin: 'led_o',
    label: 'led_o',
  };
  const diffOf = (summary: Partial<SystemGraphDiff['summary']>) =>
    ({
      instances: [],
      summary: { added: 0, removed: 0, changed: 0, version: 0, renamed: 0, ...summary },
    }) as unknown as SystemGraphDiff;
  const noFindings: FindingsDiff = { new: [], resolved: [] };

  it('fails changes with the total of all change kinds, singular and plural', () => {
    expect(failOnReason(diffOf({ added: 1 }), noFindings, 'changes', false)).toBe(
      '1 change (--fail-on changes)'
    );
    expect(
      failOnReason(
        diffOf({ added: 1, removed: 1, changed: 1, renamed: 1, version: 1 }),
        noFindings,
        'changes',
        false
      )
    ).toBe('5 changes (--fail-on changes)');
    expect(failOnReason(diffOf({}), noFindings, 'changes', false)).toBeUndefined();
  });

  it('does not count a version-only change with --ignore-version-only', () => {
    const versionOnly = diffOf({ version: 2 });
    expect(failOnReason(versionOnly, noFindings, 'changes', false)).toBe(
      '2 changes (--fail-on changes)'
    );
    expect(failOnReason(versionOnly, noFindings, 'changes', true)).toBeUndefined();
    expect(failOnReason(diffOf({ version: 2, added: 1 }), noFindings, 'changes', true)).toBe(
      '1 change (--fail-on changes)'
    );
  });

  it('fails new-findings on new findings only, singular and plural', () => {
    const one: FindingsDiff = { new: [finding], resolved: [] };
    const two: FindingsDiff = {
      new: [finding, { ...finding, pin: 'x', label: 'x' }],
      resolved: [],
    };
    expect(failOnReason(diffOf({}), one, 'new-findings', false)).toBe(
      '1 new finding (--fail-on new-findings)'
    );
    expect(failOnReason(diffOf({}), two, 'new-findings', false)).toBe(
      '2 new findings (--fail-on new-findings)'
    );
    expect(
      failOnReason(diffOf({ added: 3 }), { new: [], resolved: [finding] }, 'new-findings', false)
    ).toBeUndefined();
  });

  it('does not treat finding differences as changes, nor changes as findings', () => {
    expect(
      failOnReason(diffOf({}), { new: [finding], resolved: [] }, 'changes', false)
    ).toBeUndefined();
    expect(failOnReason(diffOf({ added: 1 }), noFindings, 'new-findings', false)).toBeUndefined();
  });

  it('passes without --fail-on', () => {
    expect(
      failOnReason(diffOf({ added: 1 }), { new: [finding], resolved: [] }, undefined, false)
    ).toBeUndefined();
  });

  describe('through main', () => {
    const run = async (...args: string[]) => {
      const write = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const code = await main(['diff', ...args]);
        return {
          code,
          stdout: write.mock.calls.map((c) => String(c[0])).join(''),
          log: log.mock.calls.map((c) => String(c[0])),
          stderr: error.mock.calls.map((c) => String(c[0])),
        };
      } finally {
        write.mockRestore();
        log.mockRestore();
        error.mockRestore();
      }
    };

    it('exits 1 on changes, still printing the report', async () => {
      const result = await run(BASE, CURRENT, '--fail-on', 'changes');
      expect(result.code).toBe(1);
      expect(result.stdout).toContain('## System design changes: zynq_gpio_system');
      expect(result.stderr).toEqual(['Diff check failed: 8 changes (--fail-on changes)']);
    });

    it('exits 0 for new-findings when only a finding was resolved', async () => {
      const result = await run(BASE, CURRENT, '--fail-on', 'new-findings');
      expect(result.code).toBe(0);
      expect(result.stderr).toEqual([]);
    });

    it('exits 1 for new-findings when the resolved finding becomes new', async () => {
      const result = await run(CURRENT, BASE, '--fail-on', 'new-findings');
      expect(result.code).toBe(1);
      expect(result.stderr).toEqual(['Diff check failed: 1 new finding (--fail-on new-findings)']);
    });

    it('exits 0 for a file against itself', async () => {
      const result = await run(BASE, BASE, '--fail-on', 'changes');
      expect(result.code).toBe(0);
      expect(result.stderr).toEqual([]);
    });

    it('writes the report to --out before failing', async () => {
      const out = path.join(tmp, 'failed-report.md');
      const result = await run(BASE, CURRENT, '--out', out, '--fail-on', 'changes');
      expect(result.code).toBe(1);
      expect(fs.readFileSync(out, 'utf8')).toContain('## System design changes: zynq_gpio_system');
      expect(result.stdout).toBe('');
      expect(result.log).toEqual([`Wrote ${out}`]);
      expect(result.stderr).toEqual(['Diff check failed: 8 changes (--fail-on changes)']);
    });

    it('fails the same way with the JSON report', async () => {
      const result = await run(BASE, CURRENT, '--format', 'json', '--fail-on', 'changes');
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stdout)).toHaveProperty('findings');
      expect(result.stderr).toEqual(['Diff check failed: 8 changes (--fail-on changes)']);
    });

    it('counts a rename as one change', async () => {
      const result = await run(
        path.join(fixtures, 'zynq_gpio_rename_base.bd'),
        path.join(fixtures, 'zynq_gpio_rename_current.bd'),
        '--fail-on',
        'changes'
      );
      expect(result.code).toBe(1);
      expect(result.stderr).toEqual(['Diff check failed: 2 changes (--fail-on changes)']);
    });
  });
});

const describeGit = gitAvailable ? describe : describe.skip;

describeGit('ipcraft diff against a git revision', () => {
  let repo: string;

  const git = (...args: string[]) => {
    const r = spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: repo });
    expect(r.status).toBe(0);
  };

  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(tmp, 'repo-'));
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.mkdirSync(path.join(repo, 'bd'));
    fs.copyFileSync(path.join(fixtures, 'nios_base.qsys'), path.join(repo, 'bd/nios_system.qsys'));
    git('add', '.');
    git('commit', '-q', '-m', 'base');
    fs.copyFileSync(
      path.join(fixtures, 'nios_current.qsys'),
      path.join(repo, 'bd/nios_system.qsys')
    );
  });

  const design = () => path.join(repo, 'bd/nios_system.qsys');
  const gitArgs = (extra: Partial<Parameters<typeof runCliDiff>[0]>) =>
    files({ files: [design()], ...extra });

  it('compares the working tree with --base HEAD', async () => {
    const result = await runCliDiff(gitArgs({ baseRef: 'HEAD' }));
    expect(result.report).toBe(golden('nios.expected.md'));
  });

  it('finds no change between HEAD and HEAD', async () => {
    const result = await runCliDiff(gitArgs({ baseRef: 'HEAD', headRef: 'HEAD' }));
    expect(result.report).toBe(
      `## System design changes: nios_system\n\n${GOLDEN_LABELS.replace('`working tree`', '`HEAD`')}\n\nNo changes.\n`
    );
  });

  it('fails outside a git repository', async () => {
    const lonely = path.join(tmp, 'lonely.qsys');
    fs.copyFileSync(path.join(fixtures, 'nios_base.qsys'), lonely);
    const result = await runCliDiff(files({ files: [lonely], baseRef: 'HEAD' }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(
      new RegExp(`^'${escapeRegExp(lonely)}' is not in a git repository: .*not a git repository`)
    );
  });

  it('fails for a revision that does not exist', async () => {
    expect(await runCliDiff(gitArgs({ baseRef: 'no-such-ref' }))).toEqual({
      success: false,
      error: "git revision 'no-such-ref' does not exist",
    });
  });

  it('fails for a file that does not exist at the revision', async () => {
    const added = path.join(repo, 'bd/new.qsys');
    fs.copyFileSync(path.join(fixtures, 'nios_base.qsys'), added);
    const result = await runCliDiff(gitArgs({ files: [added], baseRef: 'HEAD' }));
    expect(result.success).toBe(false);
    expect(result.error).toMatch(
      new RegExp(`^'${escapeRegExp(added)}' does not exist at HEAD: .*bd/new\\.qsys`)
    );
  });

  it('names the file and the revision of the current side in a parse error', async () => {
    const own = fs.mkdtempSync(path.join(tmp, 'repo-'));
    const run = (...args: string[]) =>
      expect(spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: own }).status).toBe(
        0
      );
    const file = path.join(own, 'x.qsys');
    run('init', '-q');
    run('config', 'user.email', 'test@example.com');
    run('config', 'user.name', 'Test');
    fs.copyFileSync(path.join(fixtures, 'nios_base.qsys'), file);
    run('add', '.');
    run('commit', '-q', '-m', 'valid');
    fs.writeFileSync(file, '{}');
    run('commit', '-q', '-a', '-m', 'broken');
    const result = await runCliDiff(files({ files: [file], baseRef: 'HEAD~1', headRef: 'HEAD' }));
    expect(result).toEqual({
      success: false,
      error: `'${file} at HEAD' is not a recognized system design`,
    });
  });

  it('reports a file in a folder that does not exist as not found', async () => {
    const missing = path.join(tmp, 'no-such-dir', 'x.qsys');
    expect(await runCliDiff(files({ files: [missing], baseRef: 'HEAD' }))).toEqual({
      success: false,
      error: `Input file not found: ${missing}`,
    });
  });

  it('rejects a revision that looks like an option', async () => {
    const result = await runCliDiff(gitArgs({ baseRef: '--output=x' }));
    expect(result).toEqual({ success: false, error: "Invalid git revision '--output=x'" });
  });
});
