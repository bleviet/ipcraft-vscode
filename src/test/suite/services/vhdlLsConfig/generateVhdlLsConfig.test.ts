/** @jest-environment node */
import * as fs from 'fs';
import * as path from 'path';
import * as toml from 'toml';
import {
  generateVhdlLsConfig,
  type VhdlLsConfigResult,
} from '../../../../services/vhdlLsConfig/generateVhdlLsConfig';
import { makeRepo, MULTI_CORE, QSYS_COPY, SINGLE_CORE } from './fixtures';

const roots: string[] = [];
const repo = (files: Record<string, string>): string => {
  const root = makeRepo(files);
  roots.push(root);
  return root;
};
afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

const NOW = new Date('2026-03-04T05:06:07.890Z');
const run = (root: string, over: { force?: boolean; dryRun?: boolean } = {}) =>
  generateVhdlLsConfig({ root, force: false, dryRun: false, now: NOW, ...over });

function written(result: VhdlLsConfigResult) {
  if (result.status === 'error' || result.status === 'needsConfirmation') {
    throw new Error(`unexpected ${result.status}`);
  }
  return result;
}

describe('generateVhdlLsConfig fixtures', () => {
  it('(a) maps a single core into defaultlib', async () => {
    const root = repo(SINGLE_CORE);
    const result = written(await run(root));
    expect(result.status).toBe('written');
    expect(result.text).toMatchSnapshot();
    expect(result.summary).toMatchObject({ libraries: 1, files: 2, missingLibraries: [] });
    expect(fs.readFileSync(path.join(root, 'vhdl_ls.toml'), 'utf8')).toBe(result.text);
  });

  it('(b) resolves cross-core libraries and proposes the missing one', async () => {
    const root = repo(MULTI_CORE);
    const result = written(await run(root));
    expect(result.text).toMatchSnapshot();
    expect(result.summary.missingLibraries).toEqual(['osvvm']);
    const parsed = toml.parse(result.text) as { libraries: Record<string, { files: string[] }> };
    expect(Object.keys(parsed.libraries)).toEqual(['defaultlib', 'dsp_lib']);
    expect(parsed.libraries.dsp_lib.files).toEqual(['dsp/src/fir_pkg.vhd']);
  });

  it('(c) leaves out generated Platform Designer copies', async () => {
    const root = repo(QSYS_COPY);
    const result = written(await run(root));
    expect(result.text).toMatchSnapshot();
    expect(result.text).not.toContain('X/synthesis');
    expect(result.summary.excludedFiles).toBe(0);
  });

  it('(d) asks before replacing a user-written file and backs it up with force', async () => {
    const userText = "[libraries.mine]\nfiles = ['core/rtl/*.vhd']\n";
    const root = repo({ ...SINGLE_CORE, 'vhdl_ls.toml': userText });
    const needs = await run(root);
    expect(needs).toMatchObject({ status: 'needsConfirmation', ownership: 'user' });
    expect(fs.readFileSync(path.join(root, 'vhdl_ls.toml'), 'utf8')).toBe(userText);
    expect(fs.existsSync(path.join(root, '.ipcraft'))).toBe(false);

    const result = written(await run(root, { force: true }));
    const backup = path.join(root, '.ipcraft', 'backup', 'vhdl_ls.20260304-050607.toml');
    expect(result.backupPath).toBe(backup);
    expect(fs.readFileSync(backup, 'utf8')).toBe(userText);
    expect(result.text).toContain(
      '# Previous vhdl_ls.toml saved to .ipcraft/backup/vhdl_ls.20260304-050607.toml'
    );
  });
});

describe('generateVhdlLsConfig behaviour', () => {
  it('does not propose a library for `library work;` when every file has a named library', async () => {
    const root = repo({
      'p/p.ip.yml': 'fileSets:\n  - files:\n      - path: a.vhd\n        logicalName: mylib\n',
      'p/a.vhd': 'library work;\nentity a is\nend entity;\n',
    });
    const result = written(await run(root));
    expect(result.summary.missingLibraries).toEqual([]);
    expect(result.text).not.toContain('Missing library');
  });

  it('rejects manifest entries that reach outside the root through a symlink', async () => {
    const outside = makeRepo({ 'lib/evil.vhd': 'entity evil is\nend entity;\n' });
    roots.push(outside);
    const root = repo({
      'a/a.ip.yml':
        'fileSets:\n  - files:\n      - path: link/lib/evil.vhd\n      - path: ..foo/ok.vhd\n',
      'a/..foo/ok.vhd': 'entity ok is\nend entity;\n',
    });
    fs.symlinkSync(outside, path.join(root, 'a', 'link'), 'dir');
    const result = written(await run(root));
    expect(result.summary.skippedEntries).toBe(1);
    expect(result.text).not.toContain('evil.vhd');
    expect(result.text).toContain("'a/..foo/ok.vhd',  # a/a.ip.yml");
  });

  it('keeps an owned CRLF file working: LF output, user section kept, then unchanged', async () => {
    const root = repo(SINGLE_CORE);
    const first = written(await run(root));
    const configPath = path.join(root, 'vhdl_ls.toml');
    fs.writeFileSync(configPath, `${first.text}[lint]\nunused = false\n`.replace(/\n/g, '\r\n'));
    const second = written(await run(root));
    expect(second.status).toBe('written');
    expect(second.text).not.toContain('\r');
    expect(second.text).toContain('[lint]\nunused = false\n');
    expect(written(await run(root)).status).toBe('unchanged');
  });

  it('is byte-identical and unchanged on a second run', async () => {
    const root = repo(MULTI_CORE);
    const first = written(await run(root));
    const second = written(await run(root));
    expect(second.status).toBe('unchanged');
    expect(second.text).toBe(first.text);
  });

  it('keeps the user section across regeneration and appends proposals once', async () => {
    const root = repo(MULTI_CORE);
    const first = written(await run(root));
    expect(first.text.match(/# Missing library osvvm/g)).toHaveLength(1);

    const configPath = path.join(root, 'vhdl_ls.toml');
    fs.appendFileSync(configPath, '\n[lint]\nunused = false\n');
    fs.mkdirSync(path.join(root, 'extra'));
    fs.writeFileSync(path.join(root, 'extra', 'more.vhd'), 'entity more is\nend entity;\n');

    const second = written(await run(root));
    expect(second.status).toBe('written');
    expect(second.text).toContain("'extra/more.vhd'");
    expect(second.text).toContain('[lint]\nunused = false\n');
    expect(second.text.match(/# Missing library osvvm/g)).toHaveLength(1);
    expect(second.backupPath).toBeUndefined();
  });

  it('treats an edited generated section as not owned', async () => {
    const root = repo(SINGLE_CORE);
    written(await run(root));
    const configPath = path.join(root, 'vhdl_ls.toml');
    fs.writeFileSync(configPath, fs.readFileSync(configPath, 'utf8').replace('core_pkg', 'edited'));
    expect(await run(root)).toMatchObject({ status: 'needsConfirmation', ownership: 'edited' });
  });

  it('dry run writes nothing, not even a backup', async () => {
    const root = repo({ ...SINGLE_CORE, 'vhdl_ls.toml': '# mine\n' });
    const result = await run(root, { dryRun: true });
    expect(result.status).toBe('dryRun');
    expect(fs.readFileSync(path.join(root, 'vhdl_ls.toml'), 'utf8')).toBe('# mine\n');
    expect(fs.existsSync(path.join(root, '.ipcraft'))).toBe(false);
  });

  it('reports invalid user TOML with the file line and leaves the file untouched', async () => {
    const root = repo(SINGLE_CORE);
    written(await run(root));
    const configPath = path.join(root, 'vhdl_ls.toml');
    fs.appendFileSync(configPath, '[lint]\nunused = \n');
    const before = fs.readFileSync(configPath, 'utf8');
    const lastLine = before.split('\n').length - 1;

    const result = await run(root);
    expect(result).toMatchObject({ status: 'error' });
    expect((result as { message: string }).message).toMatch(
      new RegExp(`^The user section of vhdl_ls.toml is not valid TOML \\(line ${lastLine}\\):`)
    );
    expect(fs.readFileSync(configPath, 'utf8')).toBe(before);
  });

  it('counts manifest entries that cannot be used', async () => {
    const root = repo({
      'a/a.ip.yml':
        'fileSets:\n  - files:\n      - path: rtl/gone.vhd\n      - path: ../../outside.vhd\n',
      'a/rtl/real.vhd': 'entity real is\nend entity;\n',
    });
    const result = written(await run(root));
    expect(result.summary.skippedEntries).toBe(2);
  });

  it('(e) drops user-excluded files silently when the user section defines defaultlib', async () => {
    const root = repo({
      ...SINGLE_CORE,
      'x/a.vhd': 'entity xa is\nend entity;\n',
      'x/b.vhd': 'entity xb is\nend entity;\n',
    });
    written(await run(root));
    fs.appendFileSync(
      path.join(root, 'vhdl_ls.toml'),
      "[libraries.defaultlib]\nfiles = ['x/*.vhd']\nexclude = ['x/b.vhd']\n"
    );
    const result = written(await run(root));
    expect(result.status).toBe('written');
    const parsed = toml.parse(result.text) as { libraries: Record<string, unknown> };
    expect(Object.keys(parsed.libraries)).toEqual(['defaultlib']);
    expect(result.text).not.toContain('excluded by libraries.defaultlib');
  });
});
