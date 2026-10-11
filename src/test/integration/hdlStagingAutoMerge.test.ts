/**
 * Issue #236: a hand-edited `_core` file must survive a spec change. After the
 * user edits the generated core and then adds a port to the spec, the staging
 * classification (baseline = last generated, current = disk, incoming = new
 * generation) must produce a clean auto-merge that keeps the edit, gains the new
 * port, and still compiles with GHDL / iverilog together with the regenerated RTL.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { IpCoreScaffolder, collectRtlAbsPaths } from '../../generator/IpCoreScaffolder';
import { TemplateLoader } from '../../generator/TemplateLoader';
import { loadIpCoreData } from '../../generator/loadIpCore';
import { readBaseline } from '../../generator/generationBaseline';
import { classifyModifiedFile } from '../../generator/staging/classifyStagedFile';
import { Logger } from '../../utils/Logger';
import { devResourceRoots } from '../../services/ResourceRoots';
import { guardTier1, toolOnPath } from './tier';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const EXAMPLE = 'basic_peripheral';
const EXAMPLE_DIR = path.join(REPO_ROOT, 'ipcraft-spec/examples', EXAMPLE);

type Lang = 'vhdl' | 'systemverilog';

const CASES = [
  {
    lang: 'vhdl' as const,
    ext: 'vhd',
    tool: 'ghdl',
    // Internal signal declared in the template's user region, driven from clk before the main process.
    signalAnchor: '  -- Add your internal signals here\n',
    signalEdit: "  signal user_toggle : std_logic := '0';\n",
    bodyAnchor: 'begin\n\n  ---',
    bodyEdit:
      'begin\n\n  p_user : process(clk)\n  begin\n    if rising_edge(clk) then\n      user_toggle <= not user_toggle;\n    end if;\n  end process;\n\n  ---',
    userMarker: 'user_toggle',
  },
  {
    lang: 'systemverilog' as const,
    ext: 'sv',
    tool: 'iverilog',
    signalAnchor: '  // Add your internal signals here\n',
    signalEdit:
      "  logic user_toggle = 1'b0;\n  always_ff @(posedge clk) user_toggle <= ~user_toggle;\n",
    bodyAnchor: '',
    bodyEdit: '',
    userMarker: 'user_toggle',
  },
];

let workDir = '';

const silent = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Logger;

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-staging-merge-'));
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

function compile(tool: string, lang: Lang, ordered: string[], cwd: string): void {
  if (lang === 'vhdl') {
    const workdir = fs.mkdtempSync(path.join(workDir, 'ghdl-'));
    const steps = [
      ...ordered.map((file) => ['-a', '--std=08', `--workdir=${workdir}`, file]),
      ['-e', '--std=08', `--workdir=${workdir}`, EXAMPLE],
    ];
    for (const args of steps) {
      const run = spawnSync('ghdl', args, { encoding: 'utf8', cwd, timeout: 120_000 });
      if (run.status !== 0) {
        throw new Error(
          `ghdl ${args[0]} failed for ${args[args.length - 1]}\n${run.stderr || run.stdout}`
        );
      }
    }
    return;
  }
  const run = spawnSync('iverilog', ['-g2012', '-o', path.join(cwd, 'out.vvp'), ...ordered], {
    encoding: 'utf8',
    cwd,
    timeout: 120_000,
  });
  if (run.status !== 0) {
    throw new Error(`${tool} failed\n${run.stderr || run.stdout}`);
  }
}

describe.each(CASES)('staging auto-merge of an edited core ($lang)', (c) => {
  it('merges the user edit with a spec-driven port change and still compiles', async () => {
    if (guardTier1(c.tool, () => toolOnPath(c.tool))) {
      return;
    }
    const dir = path.join(workDir, c.lang);
    fs.mkdirSync(dir, { recursive: true });
    const yamlPath = path.join(dir, `${EXAMPLE}.ip.yml`);
    fs.copyFileSync(path.join(EXAMPLE_DIR, `${EXAMPLE}.ip.yml`), yamlPath);
    fs.copyFileSync(
      path.join(EXAMPLE_DIR, `${EXAMPLE}.mm.yml`),
      path.join(dir, `${EXAMPLE}.mm.yml`)
    );

    const resourceRoots = devResourceRoots(REPO_ROOT);
    const loader = new TemplateLoader(silent, path.join(REPO_ROOT, 'src/generator/templates'));
    const scaffolder = new IpCoreScaffolder(silent, loader, resourceRoots);
    const base = { targets: [], includeRegs: true, includeTestbench: false, hdlLanguage: c.lang };

    // 1. Generate in place: writes the files and their baselines.
    const first = await scaffolder.generateAll(yamlPath, dir, base);
    expect(first.error).toBeUndefined();
    expect(first.success).toBe(true);

    // 2. Hand-edit the core's internal-signal region.
    const core = `rtl/${EXAMPLE}_core.${c.ext}`;
    const corePath = path.join(dir, core);
    let edited = fs.readFileSync(corePath, 'utf8');
    expect(edited).toContain(c.signalAnchor);
    edited = edited.replace(c.signalAnchor, c.signalEdit);
    if (c.bodyAnchor) {
      expect(edited).toContain(c.bodyAnchor);
      edited = edited.replace(c.bodyAnchor, c.bodyEdit);
    }
    fs.writeFileSync(corePath, edited);

    // 3. Spec change: add a user port.
    const spec = fs.readFileSync(yamlPath, 'utf8');
    const withPort = spec.replace(
      /^ports:\n/m,
      'ports:\n- name: dbg_out\n  direction: out\n  width: 1\n'
    );
    expect(withPort).not.toBe(spec);
    fs.writeFileSync(yamlPath, withPort);

    // 4. Dry-run regeneration, then the real staging classification for the core.
    const second = await scaffolder.generateAll(yamlPath, dir, { ...base, dryRun: true });
    expect(second.success).toBe(true);
    const generated = second.generatedContents ?? {};
    const classification = classifyModifiedFile({
      relativePath: core,
      isProtected: false,
      current: fs.readFileSync(corePath, 'utf8'),
      incoming: generated[core],
      baseline: await readBaseline(dir, core),
    });
    expect(classification.handEdited).toBe(true);
    expect(classification.defaultAction).toBe('auto-merge');
    const merged = classification.autoMergeContent ?? '';
    expect(merged).toContain(c.userMarker);
    expect(merged).toContain('dbg_out');

    // 5. Apply as Phase 4 would: merged core, regenerated everything else; then compile.
    fs.writeFileSync(corePath, merged);
    for (const rel of Object.keys(generated)) {
      if (rel.startsWith('rtl/') && rel !== core) {
        fs.writeFileSync(path.join(dir, rel), generated[rel]);
      }
    }
    const ipCoreData = await loadIpCoreData(yamlPath, resourceRoots);
    const ordered = (await collectRtlAbsPaths(generated, ipCoreData, yamlPath, dir)).filter(
      (f) => path.relative(dir, f).startsWith('rtl') && f.endsWith(`.${c.ext}`)
    );
    expect(ordered).toContain(corePath);
    compile(c.tool, c.lang, ordered, dir);
  });
});
