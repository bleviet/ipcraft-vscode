/**
 * Behavioral verification of the generated AXI4-Lite slave wrapper
 * (bus_axil templates) with more than one transaction offered at a time.
 *
 * An interconnect forwarding posted writes (e.g. a PCIe bridge behind an AXI
 * SmartConnect) offers the next write's W beat while the previous write
 * response is still pending, and the next AR while RVALID is still pending.
 * The wrapper must take one transaction at a time and complete every one with
 * the right data; accepting W or AR early loses that transaction and
 * deadlocks the port.
 *
 * The testbenches in fixtures/axil-handshake drive the complete
 * examples/basic_peripheral top (VHDL: GHDL, SystemVerilog: Icarus Verilog)
 * and report PASS/FAIL lines. Skip with SKIP_GHDL=1 / SKIP_IVERILOG=1; each
 * half self-skips when its tool is not on PATH (see tier.ts).
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { generateFixtures, Fixture } from './generator';
import { guardTier1, toolOnPath } from './tier';

const FIXTURES_DIR = path.join(__dirname, '../fixtures/axil-handshake');
const EXPECTED_CHECKS = ['writes_complete', 'reads_complete', 'read_data_out', 'read_control'];

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

/** Production compile order of the fixture's RTL files with the given extension. */
function rtlFiles(fixture: Fixture, ext: string): string[] {
  return fixture.rtlOrder
    .filter((f) => f.startsWith('rtl/') && f.endsWith(`.${ext}`))
    .map((f) => path.join(fixture.outputDir, f));
}

/** Parse `PASS <name>` / `FAIL <name>` lines (GHDL report text or SV $display) into a map. */
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

function expectAllPassed(output: string): void {
  const checks = parseChecks(output);
  const failed = Object.entries(checks).filter(([, status]) => status === 'FAIL');
  expect(failed).toEqual([]);
  expect(Object.keys(checks).sort()).toEqual([...EXPECTED_CHECKS].sort());
}

describe('AXI4-Lite slave with transactions offered back to back (behavioral)', () => {
  describe('VHDL — GHDL simulation', () => {
    it('completes every write and read with the right data', () => {
      if (guardTier1('ghdl', () => toolOnPath('ghdl'))) {
        return;
      }

      const fixture = findFixture('examples/basic_peripheral_vhdl');
      const rtl = rtlFiles(fixture, 'vhd');
      expect(rtl.length).toBeGreaterThan(0);
      const tb = path.join(FIXTURES_DIR, 'tb_axil_pipelined.vhd');

      const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-ghdl-axil-'));
      let output = '';
      try {
        const steps: string[][] = [
          ['-a', '--std=08', `--workdir=${workdir}`, ...rtl, tb],
          ['-e', '--std=08', `--workdir=${workdir}`, 'tb_axil_pipelined'],
        ];
        for (const args of steps) {
          const result = spawnSync('ghdl', args, { encoding: 'utf8', timeout: 60_000 });
          if (result.status !== 0) {
            throw new Error(`ghdl ${args[0]} failed:\n${result.stderr || result.stdout}`);
          }
        }
        const run = spawnSync(
          'ghdl',
          ['-r', '--std=08', `--workdir=${workdir}`, 'tb_axil_pipelined', '--stop-time=20us'],
          { encoding: 'utf8', timeout: 60_000 }
        );
        output = run.stdout + run.stderr;
      } finally {
        fs.rmSync(workdir, { recursive: true, force: true });
      }

      expectAllPassed(output);
    });
  });

  describe('SystemVerilog — Icarus Verilog simulation', () => {
    it('completes every write and read with the right data', () => {
      if (guardTier1('iverilog', () => toolOnPath('iverilog'))) {
        return;
      }

      const fixture = findFixture('examples/basic_peripheral_sv');
      const rtl = rtlFiles(fixture, 'sv');
      expect(rtl.length).toBeGreaterThan(0);
      const tb = path.join(FIXTURES_DIR, 'tb_axil_pipelined.sv');

      const out = path.join(os.tmpdir(), `ipcraft-iverilog-axil-${process.pid}.vvp`);
      const compile = spawnSync('iverilog', ['-g2012', '-o', out, ...rtl, tb], {
        encoding: 'utf8',
        timeout: 60_000,
      });
      if (compile.status !== 0) {
        fs.rmSync(out, { force: true });
        throw new Error(`iverilog compile failed:\n${compile.stderr || compile.stdout}`);
      }
      const run = spawnSync('vvp', [out], { encoding: 'utf8', timeout: 60_000 });
      fs.rmSync(out, { force: true });

      expectAllPassed(run.stdout + run.stderr);
    });
  });
});
