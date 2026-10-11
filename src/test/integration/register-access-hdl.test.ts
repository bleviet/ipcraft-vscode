/**
 * Compile gate for register-level `access` that disagrees with field accesses
 * (ipcraft-vscode#238, cases A-F). Field accesses decide record membership
 * (`regs` vs `regs_in`), the write `case` branch, and the read source, so the
 * generated `_regs` module must compile in VHDL (GHDL) and SystemVerilog
 * (Icarus) even when an explicit register access contradicts its fields.
 *
 * Compile-only. Skip with SKIP_GHDL=1 / SKIP_IVERILOG=1; each half self-skips
 * when its tool is not on PATH (see tier.ts).
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
const IP_YAML = path.join(__dirname, '../fixtures/register-access/register_access.ip.yml');
const OUTPUT_BASE = path.join(os.tmpdir(), `ipcraft-register-access-${process.pid}`);

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
  const scaffolder = new IpCoreScaffolder(logger, loader, devResourceRoots(REPO_ROOT));

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

afterAll(() => {
  fs.rmSync(OUTPUT_BASE, { recursive: true, force: true });
});

describe('register-level access vs field accesses (ipcraft-vscode#238)', () => {
  describe('VHDL - GHDL compile', () => {
    it('compiles the register file and gives each register the field-derived plan', async () => {
      if (guardTier1('ghdl', () => toolOnPath('ghdl'))) {
        return;
      }
      const outputDir = await generateRtl('vhdl');
      const pkg = path.join(outputDir, 'rtl/register_access_pkg.vhd');
      const regs = path.join(outputDir, 'rtl/register_access_regs.vhd');

      const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-ghdl-regaccess-'));
      try {
        const result = spawnSync('ghdl', ['-a', '--std=08', `--workdir=${workdir}`, pkg, regs], {
          encoding: 'utf8',
          timeout: 60_000,
        });
        if (result.status !== 0) {
          throw new Error(`ghdl -a failed:\n${result.stderr || result.stdout}`);
        }
      } finally {
        fs.rmSync(workdir, { recursive: true, force: true });
      }

      const text = fs.readFileSync(regs, 'utf8');
      const writeProcess = text.slice(text.indexOf('p_write'), text.indexOf('p_read'));
      expect(writeProcess).not.toMatch(/when C_REG_STATUS_A_ADDR =>/);
      expect(writeProcess).not.toMatch(/when C_REG_EVENTS_C_ADDR =>/);
      expect(writeProcess).not.toMatch(/when C_REG_STATUS_E_ADDR =>/);
      expect(text).toContain('rd_data_int <= to_slv(regs_in.status_a);');
      expect(writeProcess).toMatch(/when C_REG_CTRL_D_ADDR =>/);
    });
  });

  describe('SystemVerilog - Icarus Verilog compile', () => {
    it('compiles the register file and gives each register the field-derived plan', async () => {
      if (guardTier1('iverilog', () => toolOnPath('iverilog'))) {
        return;
      }
      const outputDir = await generateRtl('systemverilog');
      const pkg = path.join(outputDir, 'rtl/register_access_pkg.sv');
      const regs = path.join(outputDir, 'rtl/register_access_regs.sv');

      const out = path.join(os.tmpdir(), `ipcraft-iverilog-regaccess-${process.pid}.vvp`);
      try {
        const compile = spawnSync('iverilog', ['-g2012', '-o', out, pkg, regs], {
          encoding: 'utf8',
          timeout: 60_000,
        });
        if (compile.status !== 0) {
          throw new Error(`iverilog compile failed:\n${compile.stderr || compile.stdout}`);
        }
      } finally {
        fs.rmSync(out, { force: true });
      }

      const text = fs.readFileSync(regs, 'utf8');
      const writeProcess = text.slice(text.indexOf('p_write'), text.indexOf('p_read'));
      expect(writeProcess).not.toMatch(/REG_STATUS_A_ADDR:/);
      expect(writeProcess).not.toMatch(/REG_EVENTS_C_ADDR:/);
      expect(writeProcess).not.toMatch(/REG_STATUS_E_ADDR:/);
      expect(text).toContain('REG_STATUS_A_ADDR: rd_data_int <= pack_status_a(regs_in.status_a);');
      expect(writeProcess).toMatch(/REG_CTRL_D_ADDR: regs\.ctrl_d/);
    });
  });
});
