/**
 * Behavioral verification of the memory-mapped register methodology
 * documented in docs/tutorials/memory-mapped-registers.md.
 *
 * Unlike hdl.test.ts (which only proves the generated RTL *compiles*), this
 * suite drives the standalone `daq_controller_regs` module with a real
 * testbench and checks *simulated behavior*: reset values, RW read/write,
 * partial byte-strobe writes, RO status, W1C set/clear with same-cycle
 * hardware-priority arbitration, self-clearing set/clear, and register-array
 * addressing — one check per access-type idiom in the tutorial.
 *
 * `daq_controller` (ipcraft-spec/examples/daq_controller/) is the same
 * fixture the tutorial's YAML is included from, so this suite is what keeps
 * the tutorial's claims honest as the generator changes.
 *
 * Skip with SKIP_GHDL=1 / SKIP_IVERILOG=1; each half self-skips when its
 * tool is not on PATH (see tier.ts).
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { generateFixtures, Fixture } from './generator';
import { guardTier1, toolOnPath } from './tier';

const FIXTURES_DIR = path.join(__dirname, '../fixtures/register-semantics');

let fixtures: Fixture[] = [];

beforeAll(async () => {
  fixtures = await generateFixtures();
}, 300_000);

function findFixture(name: string): Fixture {
  const f = fixtures.find((fx) => fx.name === name);
  if (!f) {
    throw new Error(
      `Fixture '${name}' was not generated. Available: ${fixtures.map((fx) => fx.name).join(', ')}`
    );
  }
  return f;
}

/** Parse `PASS <name> ...` / `FAIL <name> ...` lines (GHDL report text or SV $display) into a map. */
function parseChecks(output: string): Record<string, 'PASS' | 'FAIL'> {
  const result: Record<string, 'PASS' | 'FAIL'> = {};
  const re = /\b(PASS|FAIL)\s+([A-Za-z0-9_]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output)) !== null) {
    const [, status, name] = m;
    result[name] = status as 'PASS' | 'FAIL';
  }
  return result;
}

describe('daq_controller register semantics (behavioral)', () => {
  describe('VHDL — GHDL simulation', () => {
    it('every access-type idiom behaves as documented', () => {
      if (guardTier1('ghdl', () => toolOnPath('ghdl'))) {
        return;
      }

      const fixture = findFixture('examples/daq_controller_vhdl');
      const pkg = path.join(fixture.outputDir, 'rtl/daq_controller_pkg.vhd');
      const regs = path.join(fixture.outputDir, 'rtl/daq_controller_regs.vhd');
      const tb = path.join(FIXTURES_DIR, 'tb_daq_regs.vhd');

      const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-ghdl-daq-'));
      let output = '';
      try {
        const steps: string[][] = [
          ['-a', '--std=08', `--workdir=${workdir}`, pkg, regs, tb],
          ['-e', '--std=08', `--workdir=${workdir}`, 'tb_daq_regs'],
        ];
        for (const args of steps) {
          const result = spawnSync('ghdl', args, { encoding: 'utf8', timeout: 60_000 });
          if (result.status !== 0) {
            throw new Error(`ghdl ${args[0]} failed:\n${result.stderr || result.stdout}`);
          }
        }
        const run = spawnSync(
          'ghdl',
          ['-r', '--std=08', `--workdir=${workdir}`, 'tb_daq_regs', '--stop-time=10us'],
          { encoding: 'utf8', timeout: 60_000 }
        );
        output = run.stdout + run.stderr;
      } finally {
        fs.rmSync(workdir, { recursive: true, force: true });
      }

      const checks = parseChecks(output);
      const failed = Object.entries(checks).filter(([, status]) => status === 'FAIL');
      expect(Object.keys(checks).length).toBeGreaterThan(0);
      expect(failed).toEqual([]);
    });
  });

  describe('SystemVerilog — Icarus Verilog simulation', () => {
    it('every access-type idiom behaves as documented', () => {
      if (guardTier1('iverilog', () => toolOnPath('iverilog'))) {
        return;
      }

      const fixture = findFixture('examples/daq_controller_sv');
      const pkg = path.join(fixture.outputDir, 'rtl/daq_controller_pkg.sv');
      const regs = path.join(fixture.outputDir, 'rtl/daq_controller_regs.sv');
      const tb = path.join(FIXTURES_DIR, 'tb_daq_regs.sv');

      const out = path.join(os.tmpdir(), `ipcraft-iverilog-daq-${process.pid}.vvp`);
      const compile = spawnSync('iverilog', ['-g2012', '-o', out, pkg, regs, tb], {
        encoding: 'utf8',
        timeout: 60_000,
      });
      if (compile.status !== 0) {
        fs.rmSync(out, { force: true });
        throw new Error(`iverilog compile failed:\n${compile.stderr || compile.stdout}`);
      }
      const run = spawnSync('vvp', [out], { encoding: 'utf8', timeout: 60_000 });
      fs.rmSync(out, { force: true });

      const checks = parseChecks(run.stdout + run.stderr);
      const failed = Object.entries(checks).filter(([, status]) => status === 'FAIL');
      expect(Object.keys(checks).length).toBeGreaterThan(0);
      expect(failed).toEqual([]);
    });
  });
});
