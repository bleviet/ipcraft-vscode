/**
 * Tutorial checkpoint integration tests.
 *
 * examples/tutorial/led/NN-<slug>/ holds the LED project at the start of
 * tutorial episode NN: only specs, hand-written code, and provided board files.
 * Generator output is not committed, so these tests generate every checkpoint
 * with the current generator (in a temp copy) and check that:
 *   - the specs validate and generation succeeds without touching committed files,
 *   - the user-owned core compiles with the generated RTL (GHDL),
 *   - the board project only references files that exist,
 *   - the LED behaviour of each episode holds in simulation (cocotb + GHDL),
 *   - the generated pytest wrapper really runs the generated cocotb test,
 *   - the last checkpoint generates the same RTL and packaging as the
 *     hardware-validated examples/led_avmm/.
 *
 * Skip the GHDL steps with SKIP_GHDL=1, the cocotb steps with SKIP_COCOTB=1,
 * and the pytest step with SKIP_PYTEST=1;
 * they also fail loudly when the tool is missing (see tier.ts).
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { IpCoreScaffolder, collectRtlAbsPaths } from '../../generator/IpCoreScaffolder';
import { TemplateLoader } from '../../generator/TemplateLoader';
import { Logger } from '../../utils/Logger';
import { loadIpCoreData } from '../../generator/loadIpCore';
import { devResourceRoots } from '../../services/ResourceRoots';
import { guardTier1, toolOnPath } from './tier';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const CHECKPOINTS_DIR = path.join(REPO_ROOT, 'examples/tutorial/led');
const EXAMPLE_DIR = path.join(REPO_ROOT, 'examples/led_avmm');
const IP_FILE = 'led_controller_avmm.ip.yml';
const CORE_FILE = 'rtl/led_controller_avmm_core.vhd';
const PROJECT_TCL = 'altera/quartus/de10_nano_project.tcl';
const TOP_ENTITY = 'led_controller_avmm';

const EPISODE_TB_DIR = path.join(REPO_ROOT, 'src/test/fixtures/tutorial-led');

const resourceRoots = devResourceRoots(REPO_ROOT);

const checkpoints = fs
  .readdirSync(CHECKPOINTS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(CHECKPOINTS_DIR, e.name, IP_FILE)))
  .map((e) => e.name)
  .sort();

/** Episode number from the folder name, e.g. "06-verify-in-simulation" -> 6. */
const episode = (name: string): number => Number.parseInt(name.slice(0, 2), 10);

const generated = checkpoints.filter((n) => episode(n) >= 4);
const compiled = checkpoints.filter((n) => episode(n) >= 6);
const boardProjects = checkpoints.filter((n) => episode(n) >= 9);

interface Generated {
  /** Temp copy of the checkpoint the generator ran in. */
  dir: string;
  success: boolean;
  error?: string;
  /** RTL compile order, relative to dir. */
  rtlOrder: string[];
  /** Committed file path (relative to dir) -> content before generation. */
  committed: Map<string, Buffer | string>;
}

const results = new Map<string, Generated>();
/** Temp copy of examples/led_avmm/ after generation (reference for checkpoint 10). */
let exampleDir = '';
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-tutorial-'));

function cocotbAvailable(): boolean {
  const result = spawnSync('python3', ['-c', 'import cocotb'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

function pytestAvailable(): boolean {
  const result = spawnSync('python3', ['-c', 'import pytest'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

/** Runs a cocotb Makefile with GHDL; throws with the tail of the output on failure. */
function runCocotb(makeDir: string, args: string[], env: Record<string, string> = {}): void {
  const run = spawnSync('make', ['-C', makeDir, 'SIM=ghdl', 'WAVES=0', ...args], {
    encoding: 'utf8',
    timeout: 150_000,
    env: { ...process.env, ...env },
  });
  if (run.status !== 0) {
    throw new Error(
      `cocotb GHDL run failed in ${makeDir} (exit ${run.status})\n` +
        `${run.error?.message ?? ''}${(run.stdout ?? '').slice(-3000)}${(run.stderr ?? '').slice(-1000)}`
    );
  }
}

/** Committed files, keyed by relative path; symlinks are compared by their target. */
function listFiles(root: string, rel = ''): Map<string, Buffer | string> {
  const files = new Map<string, Buffer | string>();
  for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const entryRel = path.posix.join(rel, entry.name);
    const abs = path.join(root, entryRel);
    if (entry.isSymbolicLink()) {
      files.set(entryRel, `-> ${fs.readlinkSync(abs)}`);
    } else if (entry.isDirectory()) {
      listFiles(root, entryRel).forEach((v, k) => files.set(k, v));
    } else {
      files.set(entryRel, fs.readFileSync(abs));
    }
  }
  return files;
}

beforeAll(async () => {
  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  } as unknown as Logger;
  const loader = new TemplateLoader(logger, path.join(REPO_ROOT, 'src/generator/templates'));
  const scaffolder = new IpCoreScaffolder(logger, loader, resourceRoots);

  const options = {
    targets: ['quartus' as const],
    includeRegs: true,
    includeTestbench: true,
    includeQuartusProject: true,
    hdlLanguage: 'vhdl' as const,
    scaffoldPack: 'example-with-docs',
  };

  for (const name of generated) {
    const dir = path.join(tempRoot, name);
    fs.cpSync(path.join(CHECKPOINTS_DIR, name), dir, { recursive: true, verbatimSymlinks: true });
    const committed = listFiles(dir);
    const ipPath = path.join(dir, IP_FILE);

    const result = await scaffolder.generateAll(ipPath, dir, options);

    let rtlOrder: string[] = [];
    if (result.success) {
      const ipCoreData = await loadIpCoreData(ipPath, resourceRoots);
      const absPaths = await collectRtlAbsPaths(
        result.generatedContents ?? {},
        ipCoreData,
        ipPath,
        dir
      );
      rtlOrder = absPaths.map((p) => path.relative(dir, p).replace(/\\/g, '/'));
    }
    results.set(name, { dir, success: result.success, error: result.error, rtlOrder, committed });
  }

  exampleDir = path.join(tempRoot, 'led_avmm');
  fs.cpSync(EXAMPLE_DIR, exampleDir, {
    recursive: true,
    verbatimSymlinks: true,
    // Quartus databases are build output, not part of the comparison.
    filter: (src) => !/[\\/]altera[\\/]quartus[\\/](db|incremental_db|output_files)$/.test(src),
  });
  const exampleResult = await scaffolder.generateAll(
    path.join(exampleDir, IP_FILE),
    exampleDir,
    options
  );
  if (!exampleResult.success) {
    throw new Error(`Generating examples/led_avmm failed: ${exampleResult.error}`);
  }
}, 300_000);

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function generatedFor(name: string): Generated {
  const result = results.get(name);
  if (!result) {
    throw new Error(`No generation result for ${name}`);
  }
  return result;
}

describe('tutorial checkpoints', () => {
  it('has a checkpoint for every episode from 3 to 10', () => {
    expect(checkpoints.map(episode)).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('03: the .ip.yml parses and validates', async () => {
    const name = checkpoints.find((n) => episode(n) === 3) as string;
    const data = await loadIpCoreData(path.join(CHECKPOINTS_DIR, name, IP_FILE), resourceRoots);
    expect(data.vlnv?.name).toBe(TOP_ENTITY);
  });

  describe.each(generated)('%s', (name) => {
    it('generates with the current generator and leaves committed files unchanged', () => {
      const { dir, success, error, committed } = generatedFor(name);
      expect(error).toBeUndefined();
      expect(success).toBe(true);

      const after = listFiles(dir);
      const changed = [...committed]
        .filter(([file, before]) => {
          const now = after.get(file);
          return (
            now === undefined ||
            !(Buffer.isBuffer(before) ? before.equals(now as Buffer) : before === now)
          );
        })
        .map(([file]) => file);
      expect(changed).toEqual([]);
    });
  });

  it('05: generation writes the user-logic skeleton', () => {
    const name = checkpoints.find((n) => episode(n) === 5) as string;
    const core = path.join(generatedFor(name).dir, CORE_FILE);
    expect(fs.existsSync(core)).toBe(true);
    expect(fs.readFileSync(core, 'utf8')).toContain('entity led_controller_avmm_core');
  });

  describe.each(compiled)('%s: GHDL', (name) => {
    it('analyzes and elaborates the top entity with the committed core', () => {
      if (guardTier1('ghdl', () => toolOnPath('ghdl'))) {
        return;
      }
      const { dir, rtlOrder } = generatedFor(name);
      const vhdl = rtlOrder.filter((f) => f.startsWith('rtl/') && f.endsWith('.vhd'));
      expect(vhdl).toContain(CORE_FILE);

      const workdir = fs.mkdtempSync(path.join(tempRoot, 'ghdl-'));
      const steps: string[][] = [
        ['-a', '--std=08', `--workdir=${workdir}`, ...vhdl],
        ['-e', '--std=08', `--workdir=${workdir}`, TOP_ENTITY],
      ];
      for (const args of steps) {
        const run = spawnSync('ghdl', args, { cwd: dir, encoding: 'utf8', timeout: 120_000 });
        if (run.status !== 0) {
          throw new Error(`ghdl ${args[0]} failed\n${run.stderr || run.stdout}`);
        }
      }
    });
  });

  describe.each(compiled)('%s: generated testbench', (name) => {
    it('passes with cocotb and GHDL', () => {
      if (guardTier1('ghdl', () => toolOnPath('ghdl')) || guardTier1('cocotb', cocotbAvailable)) {
        return;
      }
      runCocotb(path.join(generatedFor(name).dir, 'tb'), []);
    });
  });

  // pytest wraps each cocotb test through a TESTCASE filter. A filter that
  // matches nothing runs zero tests and still passes, so check results.xml.
  describe(`${compiled[0]}: generated pytest wrapper`, () => {
    it('runs the cocotb test under pytest', () => {
      if (
        guardTier1('ghdl', () => toolOnPath('ghdl')) ||
        guardTier1('cocotb', cocotbAvailable) ||
        guardTier1('pytest', pytestAvailable)
      ) {
        return;
      }
      const tbDir = path.join(generatedFor(compiled[0]).dir, 'tb');
      const resultsXml = path.join(tbDir, 'results.xml');
      fs.rmSync(resultsXml, { force: true });
      const run = spawnSync('python3', ['-m', 'pytest', '-q', tbDir], {
        encoding: 'utf8',
        timeout: 150_000,
        env: { ...process.env, SIM: 'ghdl', WAVES: '0' },
      });
      if (run.status !== 0) {
        throw new Error(
          `pytest failed (exit ${run.status}) ${run.error?.message ?? ''}\n${(run.stdout + run.stderr).slice(-4000)}`
        );
      }
      expect(fs.readFileSync(resultsXml, 'utf8')).toContain('<testcase');
    });
  });

  describe.each(compiled)('%s: simulation', (name) => {
    it('reads VERSION, drives the LEDs from LED_PATTERN, and runs the heartbeat events', () => {
      if (guardTier1('ghdl', () => toolOnPath('ghdl')) || guardTier1('cocotb', cocotbAvailable)) {
        return;
      }
      const { dir, rtlOrder } = generatedFor(name);
      const vhdl = rtlOrder.filter((f) => f.startsWith('rtl/') && f.endsWith('.vhd'));
      expect(vhdl).toContain(CORE_FILE);

      // S_AVMM is word-addressed (portWidthOverrides address: 2, 32-bit data), so a register's
      // byte offset goes on avs_address shifted right by 2, as a Platform Designer master does.
      const WORD_ADDRESS_SHIFT = 2;

      const simDir = fs.mkdtempSync(path.join(tempRoot, 'cocotb-'));
      fs.copyFileSync(
        path.join(EPISODE_TB_DIR, 'episode_test.py'),
        path.join(simDir, 'episode_test.py')
      );
      fs.writeFileSync(
        path.join(simDir, 'Makefile'),
        [
          'SIM ?= ghdl',
          'TOPLEVEL_LANG = vhdl',
          ...vhdl.map((f) => `VHDL_SOURCES += ${path.join(dir, f)}`),
          `TOPLEVEL = ${TOP_ENTITY}`,
          'COCOTB_TEST_MODULES = episode_test',
          'export COCOTB_TEST_MODULES',
          'EXTRA_ARGS += --std=08 -frelaxed',
          'include $(shell cocotb-config --makefiles)/Makefile.sim',
          '',
        ].join('\n')
      );
      runCocotb(simDir, [], {
        ADDR_SHIFT: String(WORD_ADDRESS_SHIFT),
        HAS_EVENTS: episode(name) >= 8 ? '1' : '0',
      });
    });
  });

  describe.each(boardProjects)('%s: board project', (name) => {
    it('references only files that exist after generation', () => {
      const { dir } = generatedFor(name);
      const realDir = path.join(CHECKPOINTS_DIR, name);
      const tcl = fs.readFileSync(path.join(realDir, PROJECT_TCL), 'utf8');
      // Platform Designer output (QIP_FILE under *_gen) is intentionally not checked.
      const refs = [
        ...tcl.matchAll(/^\s*set_global_assignment\s+-name\s+(?:VHDL_FILE|SDC_FILE)\s+(\S+)/gm),
        ...tcl.matchAll(/^\s*source\s+(\S+)/gm),
      ].map((m) => m[1]);
      expect(refs.length).toBeGreaterThan(0);

      const missing = refs.filter((ref) => {
        const target = path.resolve(realDir, path.dirname(PROJECT_TCL), ref);
        const inside = path.relative(realDir, target);
        // Files inside the checkpoint must exist after generation; paths that leave it
        // (examples/common/...) must exist in the repository.
        return !fs.existsSync(inside.startsWith('..') ? target : path.join(dir, inside));
      });
      expect(missing).toEqual([]);
    });
  });

  describe('Nios V board files', () => {
    const systemScripts = ['led_avmm_system.tcl', 'led_avmm_system_debug.tcl'];
    const withSystem = checkpoints.filter((n) => episode(n) >= 8);

    it.each(systemScripts)('%s is the same in every checkpoint from 08 on', (script) => {
      const read = (n: string) =>
        fs.readFileSync(path.join(CHECKPOINTS_DIR, n, 'altera/qsys', script), 'utf8');
      for (const name of withSystem) {
        expect(read(name)).toBe(read(withSystem[0]));
      }
    });

    it.each(systemScripts)('%s builds a Nios V system', (script) => {
      const text = fs.readFileSync(
        path.join(CHECKPOINTS_DIR, withSystem[0], 'altera/qsys', script),
        'utf8'
      );
      expect(text).toContain('intel_niosv_m');
      expect(text).not.toMatch(/nios2/i);
    });

    it.each(systemScripts)('%s maps led_ctrl at 0x00010010 for every master', (script) => {
      const text = fs.readFileSync(
        path.join(CHECKPOINTS_DIR, withSystem[0], 'altera/qsys', script),
        'utf8'
      );
      const connected = [...text.matchAll(/^add_connection\s+(\S+)\s+led_ctrl\.S_AVMM\b/gm)].map(
        (m) => m[1]
      );
      const mapped = [
        ...text.matchAll(
          /^set_connection_parameter_value\s+(\S+)\/led_ctrl\.S_AVMM\s+baseAddress\s+\{(0x[0-9a-fA-F]+)\}/gm
        ),
      ].map((m) => [m[1], Number.parseInt(m[2], 16)]);

      const masters =
        script === 'led_avmm_system_debug.tcl'
          ? ['jtag_debug_master.master', 'niosv.data_manager']
          : ['niosv.data_manager'];
      expect(connected.sort()).toEqual(masters);
      expect(mapped.sort()).toEqual(masters.map((m) => [m, 0x00010010]));
    });

    it.each(withSystem)(
      '%s: led_controller_avmm_hw.tcl is found by search path, not a link',
      (name) => {
        expect(
          fs.existsSync(path.join(CHECKPOINTS_DIR, name, 'altera/qsys/led_controller_avmm_hw.tcl'))
        ).toBe(false);
      }
    );

    it.each(boardProjects)('%s: software targets the Nios V HAL', (name) => {
      const platform = path.join(CHECKPOINTS_DIR, name, 'software/platform');
      expect(fs.readdirSync(platform)).toEqual(['niosv']);
      // bsp/ and build/ are build output (gitignored), not part of the checkpoint.
      const sources = fs
        .readdirSync(path.join(platform, 'niosv'))
        .filter((f) => f !== 'bsp' && f !== 'build');
      expect(sources.sort()).toEqual(['main.c', 'platform.c']);
    });
  });

  describe('10: functional equivalence with the finished example', () => {
    // The example spells its descriptions differently (longer text, folded scalars), so
    // the one place a description reaches generated code is dropped before comparing:
    // the entity header comment of the top level and the Platform Designer component
    // DESCRIPTION. Everything else is compared byte for byte.
    const dropDescriptions = (text: string): string =>
      text
        .replace(/^-- Description:[^\n]*\n(?:\n)?/m, '')
        .replace(/^set_module_property DESCRIPTION "[^"]*"\n/m, '');

    const generatedFiles = [
      'rtl/led_controller_avmm.vhd',
      'rtl/led_controller_avmm_avmm.vhd',
      'rtl/led_controller_avmm_pkg.vhd',
      'rtl/led_controller_avmm_regs.vhd',
      CORE_FILE,
      'altera/led_controller_avmm_hw.tcl',
      'altera/led_controller_avmm.sdc',
      'altera/led_controller_avmm_project.tcl',
    ];

    it.each(generatedFiles)('generates the same %s as examples/led_avmm', (file) => {
      const name = checkpoints.find((n) => episode(n) === 10) as string;
      const read = (root: string) =>
        dropDescriptions(fs.readFileSync(path.join(root, file), 'utf8'));
      expect(read(generatedFor(name).dir)).toBe(read(exampleDir));
    });

    it('has the same user-owned core', () => {
      const name = checkpoints.find((n) => episode(n) === 10) as string;
      const core = (root: string) => fs.readFileSync(path.join(root, CORE_FILE));
      expect(core(path.join(CHECKPOINTS_DIR, name)).equals(core(EXAMPLE_DIR))).toBe(true);
    });
  });
});
