/**
 * Behavioral verification of multi-bit W1C/SC/CoS fields (ipcraft-vscode#31)
 * and a hardware-driven RO field mixed into an otherwise SW-writable register
 * with no monitorChangeOf (ipcraft-vscode#32 item 2).
 *
 * None of the existing example fixtures (ipcraft-spec/examples/) exercise a
 * multi-bit W1C/SC/CoS field or a plain mixed register without CoS, so this
 * suite generates its own small fixture directly (not via generateFixtures(),
 * which only scans the ipcraft-spec submodule) and drives the standalone
 * `_regs` module with a real testbench, mirroring register-semantics.test.ts.
 *
 * Skip with SKIP_GHDL=1 / SKIP_IVERILOG=1; each half self-skips when its tool
 * is not on PATH (see tier.ts).
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { IpCoreScaffolder } from '../../generator/IpCoreScaffolder';
import { TemplateLoader } from '../../generator/TemplateLoader';
import { Logger } from '../../utils/Logger';
import { devResourceRoots } from '../../services/ResourceRoots';
import { guardTier1, toolOnPath } from './tier';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const GENERATOR_TEMPLATES = path.join(REPO_ROOT, 'src/generator/templates');
const FIXTURES_DIR = path.join(__dirname, '../fixtures/mixed-and-multibit');
const IP_YAML = path.join(FIXTURES_DIR, 'mixed_and_multibit.ip.yml');
const OUTPUT_BASE = path.join(os.tmpdir(), `ipcraft-mixed-multibit-${process.pid}`);

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

async function generateRtl(hdlLanguage: 'vhdl' | 'systemverilog'): Promise<string> {
  const outputDir = path.join(OUTPUT_BASE, hdlLanguage);
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  } as unknown as Logger;
  const loader = new TemplateLoader(logger, GENERATOR_TEMPLATES);
  const resourceRoots = devResourceRoots(REPO_ROOT);
  const scaffolder = new IpCoreScaffolder(logger, loader, resourceRoots);

  const result = await scaffolder.generateAll(IP_YAML, outputDir, {
    targets: [],
    includeRegs: true,
    includeTestbench: false,
    includeVivadoProject: false,
    includeQuartusProject: false,
    hdlLanguage,
  });

  if (!result.success) {
    throw new Error(`Generation failed for ${hdlLanguage}: ${result.error}`);
  }
  return outputDir;
}

describe('multi-bit W1C/SC/CoS and mixed RO field (behavioral)', () => {
  describe('VHDL — GHDL simulation', () => {
    it('every multi-bit and mixed-field idiom behaves as documented', async () => {
      if (guardTier1('ghdl', () => toolOnPath('ghdl'))) {
        return;
      }

      const outputDir = await generateRtl('vhdl');
      const pkg = path.join(outputDir, 'rtl/mixed_and_multibit_pkg.vhd');
      const regs = path.join(outputDir, 'rtl/mixed_and_multibit_regs.vhd');
      const tb = path.join(FIXTURES_DIR, 'tb_mixed_multibit.vhd');

      const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-ghdl-mixed-'));
      let output = '';
      try {
        const steps: string[][] = [
          ['-a', '--std=08', `--workdir=${workdir}`, pkg, regs, tb],
          ['-e', '--std=08', `--workdir=${workdir}`, 'tb_mixed_multibit'],
        ];
        for (const args of steps) {
          const result = spawnSync('ghdl', args, { encoding: 'utf8', timeout: 60_000 });
          if (result.status !== 0) {
            throw new Error(`ghdl ${args[0]} failed:\n${result.stderr || result.stdout}`);
          }
        }
        const run = spawnSync(
          'ghdl',
          ['-r', '--std=08', `--workdir=${workdir}`, 'tb_mixed_multibit', '--stop-time=10us'],
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
    it('every multi-bit and mixed-field idiom behaves as documented', async () => {
      if (guardTier1('iverilog', () => toolOnPath('iverilog'))) {
        return;
      }

      const outputDir = await generateRtl('systemverilog');
      const pkg = path.join(outputDir, 'rtl/mixed_and_multibit_pkg.sv');
      const regs = path.join(outputDir, 'rtl/mixed_and_multibit_regs.sv');
      const tb = path.join(FIXTURES_DIR, 'tb_mixed_multibit.sv');

      const out = path.join(os.tmpdir(), `ipcraft-iverilog-mixed-${process.pid}.vvp`);
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
