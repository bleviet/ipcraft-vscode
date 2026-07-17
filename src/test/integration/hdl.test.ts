/**
 * Open-source HDL toolchain integration tests.
 *
 * For every generated fixture:
 *   - VHDL: GHDL analyze + elaborate + synthesize (--synth) the top entity.
 *   - SystemVerilog: Icarus Verilog (iverilog -g2012) compile.
 *   - SystemVerilog: Verilator --lint-only (catches width mismatches and port
 *     issues that iverilog accepts; Verilator's default warnings are fatal).
 *
 * Unlike the Vivado/Quartus suites these run with freely available tools, so
 * they verify on any machine that the generated RTL compiles for simulation
 * and passes a synthesis elaboration.
 *
 * Skip with SKIP_GHDL=1 / SKIP_IVERILOG=1 / SKIP_VERILATOR=1; suites also
 * self-skip when the tool is not on PATH.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { generateFixtures, Fixture } from './generator';
import { guardTier1, toolOnPath } from './tier';

let fixtures: Fixture[] = [];

beforeAll(async () => {
  fixtures = await generateFixtures();
}, 300_000);

/**
 * The top unit is the rtl file without a _pkg/_regs/_core/bus-wrapper suffix.
 * Two-pass like vivado.test.ts: fall back to accepting a _core file for IPs
 * whose VLNV name itself ends in _core (minimal-pack top-only fixtures).
 */
function topUnit(ordered: string[], ext: string): string | null {
  const baseFilter = (f: string) =>
    !f.endsWith(`_pkg.${ext}`) &&
    !f.endsWith(`_regs.${ext}`) &&
    !/_(axil|avmm|axi4)\.(vhd|sv)$/.test(f);
  const top =
    ordered.find((f) => baseFilter(f) && !f.endsWith(`_core.${ext}`)) ??
    ordered.find((f) => baseFilter(f));
  return top ? path.basename(top, `.${ext}`) : null;
}

describe('GHDL: generated VHDL compiles for simulation and synthesis', () => {
  it('analyzes, elaborates and synthesizes every VHDL fixture', () => {
    if (guardTier1('ghdl', () => toolOnPath('ghdl'))) {
      return;
    }

    const vhdlFixtures = fixtures.filter((f) => f.success && f.name.endsWith('_vhdl'));
    expect(vhdlFixtures.length).toBeGreaterThan(0);

    const failures: string[] = [];

    for (const fixture of vhdlFixtures) {
      const ordered = fixture.rtlOrder.filter((f) => f.startsWith('rtl/') && f.endsWith('.vhd'));
      if (ordered.length === 0) {
        continue;
      }
      const top = topUnit(ordered, 'vhd');
      if (!top) {
        failures.push(`${fixture.name}: could not determine top entity`);
        continue;
      }

      const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-ghdl-'));
      try {
        const steps: string[][] = [
          ['-a', '--std=08', `--workdir=${workdir}`, ...ordered],
          ['-e', '--std=08', `--workdir=${workdir}`, top],
          ['--synth', '--std=08', `--workdir=${workdir}`, top],
        ];
        for (const args of steps) {
          const result = spawnSync('ghdl', args, {
            cwd: fixture.outputDir,
            encoding: 'utf8',
            timeout: 120_000,
          });
          if (result.status !== 0) {
            failures.push(
              `${fixture.name}: ghdl ${args[0]} failed\n${result.stderr || result.stdout}`
            );
            break;
          }
        }
      } finally {
        fs.rmSync(workdir, { recursive: true, force: true });
      }
    }

    if (failures.length > 0) {
      throw new Error(`GHDL validation failed:\n\n${failures.join('\n\n')}`);
    }
  });
});

describe('Icarus Verilog: generated SystemVerilog compiles', () => {
  it('compiles every SystemVerilog fixture with iverilog -g2012', () => {
    if (guardTier1('iverilog', () => toolOnPath('iverilog'))) {
      return;
    }

    const svFixtures = fixtures.filter((f) => f.success && f.name.endsWith('_sv'));
    expect(svFixtures.length).toBeGreaterThan(0);

    const failures: string[] = [];

    for (const fixture of svFixtures) {
      const ordered = fixture.rtlOrder.filter((f) => f.startsWith('rtl/') && f.endsWith('.sv'));
      if (ordered.length === 0) {
        continue;
      }

      const out = path.join(os.tmpdir(), `ipcraft-iverilog-${process.pid}.vvp`);
      const result = spawnSync('iverilog', ['-g2012', '-o', out, ...ordered], {
        cwd: fixture.outputDir,
        encoding: 'utf8',
        timeout: 120_000,
      });
      fs.rmSync(out, { force: true });

      if (result.status !== 0) {
        failures.push(`${fixture.name}: iverilog failed\n${result.stderr || result.stdout}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`iverilog validation failed:\n\n${failures.join('\n\n')}`);
    }
  });
});

describe('Verilator: generated SystemVerilog passes lint', () => {
  it('lints every SystemVerilog fixture with verilator --lint-only', () => {
    if (guardTier1('verilator', () => toolOnPath('verilator'))) {
      return;
    }

    const svFixtures = fixtures.filter((f) => f.success && f.name.endsWith('_sv'));
    expect(svFixtures.length).toBeGreaterThan(0);

    const failures: string[] = [];

    for (const fixture of svFixtures) {
      const ordered = fixture.rtlOrder.filter((f) => f.startsWith('rtl/') && f.endsWith('.sv'));
      if (ordered.length === 0) {
        continue;
      }
      const top = topUnit(ordered, 'sv');
      if (!top) {
        failures.push(`${fixture.name}: could not determine top module`);
        continue;
      }

      // Verilator's default warning set (WIDTH*, PINMISSING, ...) is fatal by
      // default — already stricter than iverilog. -Wall adds style warnings;
      // enable it once the templates are clean against the defaults.
      const result = spawnSync('verilator', ['--lint-only', '--top-module', top, ...ordered], {
        cwd: fixture.outputDir,
        encoding: 'utf8',
        timeout: 120_000,
      });

      if (result.status !== 0) {
        failures.push(`${fixture.name}: verilator lint failed\n${result.stderr || result.stdout}`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`Verilator validation failed:\n\n${failures.join('\n\n')}`);
    }
  });
});
