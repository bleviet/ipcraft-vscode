/**
 * vhdl_ls.toml generator against rust_hdl. The oracle is `vhdl_lang -c vhdl_ls.toml` run in the
 * fixture root: exit 0 means every name resolved and no unit was declared twice.
 *
 * Binary: env VHDL_LANG, else `vhdl_lang` on PATH. Tier 2: skipped with a warning when absent,
 * a failure when REQUIRE_VHDL_LANG=1.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { generateVhdlLsConfig } from '../../services/vhdlLsConfig/generateVhdlLsConfig';
import { guardTier2, toolOnPath } from './tier';

const vhdlLang = process.env['VHDL_LANG'] ?? 'vhdl_lang';
const available = (): boolean =>
  process.env['VHDL_LANG'] ? fs.existsSync(vhdlLang) : toolOnPath(vhdlLang);

const pkg = (name: string): string =>
  `package ${name} is\n  constant c : integer := 1;\nend package;\n`;
const top = (name: string, uses: string): string =>
  `library ieee;\nuse ieee.std_logic_1164.all;\n${uses}\nentity ${name} is\n  port (clk : in std_logic);\nend entity;\n` +
  `architecture rtl of ${name} is\nbegin\nend architecture;\n`;

/** (b) Cross-library `use`, a shared package in the default library, and a colliding copy. */
const MULTI_CORE: Record<string, string> = {
  'dsp/dsp.xpr':
    '<?xml version="1.0"?><Project><FileSets><FileSet Name="sources_1">' +
    '<File Path="$PPRDIR/src/fir_pkg.vhd"><FileInfo><Attr Name="Library" Val="dsp_lib"/></FileInfo></File>' +
    '</FileSet></FileSets></Project>',
  'dsp/src/fir_pkg.vhd': pkg('fir_pkg'),
  'ctrl/ctrl.ip.yml': 'fileSets:\n  - name: RTL\n    files:\n      - path: rtl/ctrl.vhd\n',
  'ctrl/rtl/ctrl.vhd': top(
    'ctrl',
    'library dsp_lib;\nuse dsp_lib.fir_pkg.all;\nuse work.common_pkg.all;'
  ),
  'common/common_pkg.vhd': pkg('common_pkg'),
  'common/gen_copy/common_pkg.vhd': pkg('common_pkg'),
};

/** (c) A .qsf naming only X.qsys whose generated copy would collide with the component source. */
const QSYS_COPY: Record<string, string> = {
  'proj/top.qsf':
    'set_global_assignment -name QSYS_FILE X.qsys\nset_global_assignment -name VHDL_FILE top.vhd\n',
  'proj/X.qsys': '<system/>',
  'proj/top.vhd': top('top', 'use work.comp_pkg.all;'),
  'proj/X/synthesis/submodules/comp.vhd': pkg('comp_pkg'),
  'ip/comp/comp_hw.tcl':
    'add_fileset QUARTUS_SYNTH QUARTUS_SYNTH\nadd_fileset_file comp.vhd VHDL PATH rtl/comp.vhd\n',
  'ip/comp/rtl/comp.vhd': pkg('comp_pkg'),
};

function makeRepo(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vhdl-ls-int-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

function lint(root: string): { status: number | null; output: string } {
  const run = spawnSync(vhdlLang, ['-c', 'vhdl_ls.toml'], { cwd: root, encoding: 'utf8' });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

describe('vhdl_ls.toml accepted by rust_hdl', () => {
  const roots: string[] = [];
  afterAll(() => roots.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));

  async function generate(files: Record<string, string>): Promise<string> {
    const root = makeRepo(files);
    roots.push(root);
    const result = await generateVhdlLsConfig({ root, force: false, dryRun: false });
    expect(result.status).toBe('written');
    return root;
  }

  it('resolves cross-core libraries and excludes the colliding copy', async () => {
    if (guardTier2('vhdl_lang', available, 'set VHDL_LANG or put vhdl_lang on PATH')) {
      return;
    }
    const root = await generate(MULTI_CORE);
    const text = fs.readFileSync(path.join(root, 'vhdl_ls.toml'), 'utf8');
    expect(text).toContain('# excluded: common/gen_copy/common_pkg.vhd');
    const result = lint(root);
    expect(result.output).not.toMatch(/error/i);
    expect(result.status).toBe(0);
  });

  it('detects unresolved names when a generated library mapping is removed', async () => {
    if (guardTier2('vhdl_lang', available, 'set VHDL_LANG or put vhdl_lang on PATH')) {
      return;
    }
    const root = await generate(MULTI_CORE);
    const configPath = path.join(root, 'vhdl_ls.toml');
    const stripped = fs
      .readFileSync(configPath, 'utf8')
      .replace(/libraries\.dsp_lib\.files = \[[\s\S]*?\n\]\n/, '');
    expect(stripped).not.toContain('dsp_lib.files');
    fs.writeFileSync(configPath, stripped);
    expect(lint(root).status).not.toBe(0);
  });

  it('ignores generated Platform Designer copies', async () => {
    if (guardTier2('vhdl_lang', available, 'set VHDL_LANG or put vhdl_lang on PATH')) {
      return;
    }
    const root = await generate(QSYS_COPY);
    const result = lint(root);
    expect(result.output).not.toMatch(/error/i);
    expect(result.status).toBe(0);
  });
});
