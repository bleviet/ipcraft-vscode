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
 *   - the last checkpoint still matches examples/led_avmm/.
 *
 * Skip the GHDL steps with SKIP_GHDL=1; they also fail loudly when GHDL is
 * missing (see tier.ts).
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as yaml from 'js-yaml';
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
const MM_FILE = 'led_controller_avmm.mm.yml';
const CORE_FILE = 'rtl/led_controller_avmm_core.vhd';
const PROJECT_TCL = 'altera/quartus/de10_nano_project.tcl';
const TOP_ENTITY = 'led_controller_avmm';

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
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-tutorial-'));

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

  for (const name of generated) {
    const dir = path.join(tempRoot, name);
    fs.cpSync(path.join(CHECKPOINTS_DIR, name), dir, { recursive: true, verbatimSymlinks: true });
    const committed = listFiles(dir);
    const ipPath = path.join(dir, IP_FILE);

    const result = await scaffolder.generateAll(ipPath, dir, {
      targets: ['quartus'],
      includeRegs: true,
      includeTestbench: true,
      includeQuartusProject: true,
      hdlLanguage: 'vhdl',
      scaffoldPack: 'example-with-docs',
    });

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

  it('10: matches the finished example', () => {
    const name = checkpoints.find((n) => episode(n) === 10) as string;
    const dir = path.join(CHECKPOINTS_DIR, name);
    for (const file of [MM_FILE, CORE_FILE]) {
      expect(
        fs.readFileSync(path.join(dir, file)).equals(fs.readFileSync(path.join(EXAMPLE_DIR, file)))
      ).toBe(true);
    }

    const parse = (p: string) => yaml.load(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
    const { fileSets: _fileSets, ...example } = parse(path.join(EXAMPLE_DIR, IP_FILE));
    expect(parse(path.join(dir, IP_FILE))).toEqual(example);
  });
});
