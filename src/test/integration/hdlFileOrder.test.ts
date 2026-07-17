/**
 * GHDL-oracle regression test for issue #91 (reopened) — RTL compile order in
 * generated component.xml / hw.tcl.
 *
 * A prior fix (commit 52b7d6f) sorted fallback RTL lists with a filename-suffix
 * heuristic (`hdlCompileRank`: _pkg -> 0, _regs -> 1, _core -> 2, bus-suffix -> 3,
 * else -> 4). That heuristic is blind to real dependencies: two adversarially named
 * files below ('main_logic.vhd', 'weird_types.vhd') sort in the WRONG compile order
 * both alphabetically and under that heuristic, even though 'main_logic.vhd' actually
 * `use work`s a package 'weird_types.vhd' declares.
 *
 * This test proves, with a real `ghdl -a` analyze pass, that:
 *   1. The wrong (declared) order genuinely fails to compile (negative control —
 *      proves the test can actually discriminate correct vs. incorrect order).
 *   2. generateComponentXml's fileSets fallback (VivadoComponentXmlGenerator.ts)
 *      produces an order GHDL accepts.
 *   3. resolveHwTclRtlFiles's fileSets fallback (QuartusToolchain.ts) produces an
 *      order GHDL accepts.
 *
 * Both (2) and (3) go through the same resolveFileSetRtlFiles() helper
 * (src/utils/compilationOrder.ts), but are exercised here via each toolchain's own
 * public entry point so a regression in either call site is caught directly.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { generateComponentXml } from '../../generator/VivadoComponentXmlGenerator';
import { resolveHwTclRtlFiles } from '../../services/toolchains/QuartusToolchain';
import type { IpCoreData } from '../../generator/types';
import { guardTier1, toolOnPath } from './tier';

// package declared in weird_types.vhd, used by main_logic.vhd. Neither file name
// matches a _pkg/_regs/_core/bus-suffix convention, and 'main_logic.vhd' sorts
// alphabetically BEFORE 'weird_types.vhd' — the wrong compile order.
const WEIRD_TYPES_VHD = [
  'package weird_types_pkg is',
  '  type state_t is (idle, busy, done);',
  'end package weird_types_pkg;',
  '',
].join('\n');

const MAIN_LOGIC_VHD = [
  'library ieee;',
  'use ieee.std_logic_1164.all;',
  'use work.weird_types_pkg.all;',
  '',
  'entity main_logic is',
  '  port (',
  '    clk   : in std_logic;',
  '    state : out state_t',
  '  );',
  'end entity main_logic;',
  '',
  'architecture rtl of main_logic is',
  'begin',
  '  state <= idle;',
  'end architecture rtl;',
  '',
].join('\n');

function makeIpCoreData(): IpCoreData {
  return {
    vlnv: { vendor: 'acme', library: 'ip', name: 'main_logic', version: '1.0.0' },
    busInterfaces: [],
    fileSets: [
      {
        name: 'RTL_Sources',
        // Declared in the WRONG order — main_logic (the user) before weird_types
        // (its dependency).
        files: [
          { path: 'rtl/main_logic.vhd', type: 'vhdl' },
          { path: 'rtl/weird_types.vhd', type: 'vhdl' },
        ],
      },
    ],
  } as IpCoreData;
}

function ghdlAnalyze(cwd: string, relPaths: string[]): { success: boolean; output: string } {
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-ghdl-order-'));
  try {
    const result = spawnSync('ghdl', ['-a', '--std=08', `--workdir=${workdir}`, ...relPaths], {
      cwd,
      encoding: 'utf8',
      timeout: 60_000,
    });
    return { success: result.status === 0, output: result.stderr || result.stdout || '' };
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

describe('GHDL oracle: RTL compile order (issue #91, reopened)', () => {
  let scratchDir: string;

  beforeAll(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-hdl-file-order-'));
    fs.mkdirSync(path.join(scratchDir, 'rtl'), { recursive: true });
    fs.writeFileSync(path.join(scratchDir, 'rtl', 'weird_types.vhd'), WEIRD_TYPES_VHD);
    fs.writeFileSync(path.join(scratchDir, 'rtl', 'main_logic.vhd'), MAIN_LOGIC_VHD);
  });

  afterAll(() => {
    if (scratchDir) {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it('negative control: the raw declared (wrong) order fails to compile', () => {
    if (guardTier1('ghdl', () => toolOnPath('ghdl'))) {
      return;
    }
    // Proves this test can actually discriminate correct vs. incorrect order —
    // if this assertion ever fails, the rest of this suite is not trustworthy.
    const { success, output } = ghdlAnalyze(scratchDir, [
      'rtl/main_logic.vhd',
      'rtl/weird_types.vhd',
    ]);
    expect(success).toBe(false);
    expect(output.length).toBeGreaterThan(0);
  });

  it('generateComponentXml fileSets fallback produces a GHDL-compilable order', async () => {
    if (guardTier1('ghdl', () => toolOnPath('ghdl'))) {
      return;
    }

    const xml = await generateComponentXml(
      makeIpCoreData(),
      {},
      { ipCoreDir: scratchDir, filePathPrefix: '' }
    );

    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const m of xml.matchAll(/<spirit:name>(rtl\/[^<]+\.vhd)<\/spirit:name>/g)) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        ordered.push(m[1]);
      }
    }
    expect(ordered).toEqual(['rtl/weird_types.vhd', 'rtl/main_logic.vhd']);

    const { success, output } = ghdlAnalyze(scratchDir, ordered);
    if (!success) {
      throw new Error(`ghdl -a failed on order [${ordered.join(', ')}]:\n${output}`);
    }
  });

  it('resolveHwTclRtlFiles fileSets fallback produces a GHDL-compilable order', async () => {
    if (guardTier1('ghdl', () => toolOnPath('ghdl'))) {
      return;
    }

    const entries = await resolveHwTclRtlFiles(
      undefined,
      makeIpCoreData(),
      false,
      'main_logic',
      scratchDir
    );
    // Entries are paths relative to a vendor subdir one level inside outputDir
    // (hence the leading '../'); scratchDir here doubles as ipCoreDir directly, so
    // strip that prefix back off before resolving relative to scratchDir.
    const ordered = entries.map((e) => e.path.replace(/^\.\.\//, ''));
    expect(ordered).toEqual(['rtl/weird_types.vhd', 'rtl/main_logic.vhd']);

    const { success, output } = ghdlAnalyze(scratchDir, ordered);
    if (!success) {
      throw new Error(`ghdl -a failed on order [${ordered.join(', ')}]:\n${output}`);
    }
  });
});
