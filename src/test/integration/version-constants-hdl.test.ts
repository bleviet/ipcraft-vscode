/**
 * Behavioral verification of `$version` register constants in the generated register file.
 *
 * A constant (a `$version` field or a register-level `$version`) is a read-only literal: the bus
 * read returns the resolved value, writes never change it, and it is neither stored (`regs_out`)
 * nor a hardware input (`regs_in`). Four designs are generated into temp directories (a core may
 * hold only one version register) with core version 1.4.2 under `major.minor.patch` (0x010402):
 *
 *   - `fields`: VERSION made of constant fields MAJOR/MINOR/PATCH (+ a read-write CTRL),
 *   - `register`: a fieldless register-level `resetValue: $version` (+ CTRL),
 *   - `mixed`: IDENT with a constant REV next to a read-write ENABLE and a hardware-driven
 *     read-only BUSY (the only register; `regs_in` exists for the `ident_val` record alone),
 *   - `only`: a fieldless `resetValue: $version` as the only register, plus user ports.
 *
 * The standalone `_regs` module is driven by the testbenches in fixtures/version-constants, in
 * VHDL (GHDL) and SystemVerilog (Icarus Verilog). For `only` the whole generated chain (bus
 * wrapper, core, top) is also analyzed/compiled: the wrapper must not degrade to a stub.
 *
 * Skip with SKIP_GHDL=1 / SKIP_IVERILOG=1; each half self-skips when its tool is not on PATH
 * (see tier.ts).
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
const FIXTURES_DIR = path.join(__dirname, '../fixtures/version-constants');
const OUTPUT_BASE = path.join(os.tmpdir(), `ipcraft-version-constants-${process.pid}`);

type Design = 'fields' | 'register' | 'mixed' | 'only';
type Language = 'vhdl' | 'systemverilog';
const DESIGNS: Design[] = ['fields', 'register', 'mixed', 'only'];

const REGISTERS: Record<Design, string> = {
  fields: `
    - name: VERSION
      offset: 0x00
      fields:
      - { name: MAJOR, bits: '[23:16]', resetValue: $version.major }
      - { name: MINOR, bits: '[15:8]', resetValue: $version.minor }
      - { name: PATCH, bits: '[7:0]', resetValue: $version.patch }
    - name: CTRL
      offset: 0x04
      fields:
      - { name: EN, bits: '[0:0]', access: read-write }
`,
  register: `
    - { name: VERSION, offset: 0x00, resetValue: $version }
    - name: CTRL
      offset: 0x04
      fields:
      - { name: EN, bits: '[0:0]', access: read-write }
`,
  mixed: `
    - name: IDENT
      offset: 0x00
      fields:
      - { name: REV, bits: '[31:24]', resetValue: $version.major }
      - { name: BUSY, bits: '[7:4]', access: read-only }
      - { name: ENABLE, bits: '[0:0]', access: read-write, resetValue: 1 }
`,
  only: `
    - { name: VERSION, offset: 0x00, resetValue: $version }
`,
};

const IP_YAML = `
apiVersion: '1.2'
vlnv: { vendor: ipcraft, library: test, name: ver_core, version: 1.4.2, versionScheme: major.minor.patch }
scaffold_pack: builtin-ipcraft
clocks:
- { name: clk, logicalName: CLK, direction: in, associatedReset: reset_n }
resets:
- { name: reset_n, logicalName: RESET_N, direction: in, polarity: activeLow, associatedClock: clk }
`;

const BUS_YAML = `
busInterfaces:
- name: S_AXI_LITE
  type: ipcraft:busif:axi4_lite:1.0
  mode: slave
  physicalPrefix: s_axil_
  associatedClock: clk
  associatedReset: reset_n
  memoryMapRef: CSR_MAP
  portWidthOverrides: { AWADDR: 8, ARADDR: 8, WDATA: 32, RDATA: 32, WSTRB: 4 }
memoryMaps:
  import: ver_core.mm.yml
`;

/** The `only` design also has user ports: without a register file they used to turn the wrapper into a stub. */
const USER_PORTS_YAML = `
ports:
- { name: user_ctrl, direction: out, width: 8 }
- { name: user_status, direction: in, width: 8 }
`;

const ipYaml = (design: Design): string =>
  IP_YAML + (design === 'only' ? USER_PORTS_YAML : '') + BUS_YAML;

function mmYaml(design: Design): string {
  return `- name: CSR_MAP
  addressBlocks:
  - name: REGS
    baseAddress: 0
    usage: register
    registers:${REGISTERS[design]}`;
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

async function generateRtl(design: Design, language: Language): Promise<string> {
  const outputDir = path.join(OUTPUT_BASE, `${design}-${language}`);
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'ver_core.ip.yml'), ipYaml(design));
  fs.writeFileSync(path.join(outputDir, 'ver_core.mm.yml'), mmYaml(design));

  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  } as unknown as Logger;
  const scaffolder = new IpCoreScaffolder(
    logger,
    new TemplateLoader(logger, GENERATOR_TEMPLATES),
    devResourceRoots(REPO_ROOT)
  );
  const result = await scaffolder.generateAll(path.join(outputDir, 'ver_core.ip.yml'), outputDir, {
    targets: [],
    includeRegs: true,
    includeTestbench: false,
    includeVivadoProject: false,
    includeQuartusProject: false,
    hdlLanguage: language,
  });
  if (!result.success) {
    throw new Error(`Generation failed for ${design}/${language}: ${result.error}`);
  }
  return outputDir;
}

function expectAllPass(output: string): void {
  const checks = parseChecks(output);
  const failed = Object.entries(checks).filter(([, status]) => status === 'FAIL');
  expect(Object.keys(checks).length).toBeGreaterThan(0);
  expect(failed).toEqual([]);
}

const TESTBENCH: Record<Design, string> = {
  fields: 'tb_version_const',
  register: 'tb_version_const',
  mixed: 'tb_version_mixed',
  only: 'tb_version_only',
};

describe('$version register constants (behavioral)', () => {
  describe('VHDL — GHDL simulation', () => {
    it.each<Design>(DESIGNS)(
      '%s: the constant reads as its literal and ignores writes',
      async (design) => {
        if (guardTier1('ghdl', () => toolOnPath('ghdl'))) {
          return;
        }

        const outputDir = await generateRtl(design, 'vhdl');
        const pkg = path.join(outputDir, 'rtl/ver_core_pkg.vhd');
        const regs = path.join(outputDir, 'rtl/ver_core_regs.vhd');
        const top = TESTBENCH[design];
        const tb = path.join(FIXTURES_DIR, `${top}.vhd`);

        const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-ghdl-version-'));
        let output = '';
        try {
          const steps: string[][] = [
            ['-a', '--std=08', `--workdir=${workdir}`, pkg, regs, tb],
            ['-e', '--std=08', `--workdir=${workdir}`, top],
          ];
          for (const args of steps) {
            const result = spawnSync('ghdl', args, { encoding: 'utf8', timeout: 60_000 });
            if (result.status !== 0) {
              throw new Error(`ghdl ${args[0]} failed:\n${result.stderr || result.stdout}`);
            }
          }
          const run = spawnSync(
            'ghdl',
            ['-r', '--std=08', `--workdir=${workdir}`, top, '--stop-time=10us'],
            { encoding: 'utf8', timeout: 60_000 }
          );
          output = run.stdout + run.stderr;
        } finally {
          fs.rmSync(workdir, { recursive: true, force: true });
        }
        expectAllPass(output);
      }
    );
  });

  describe('SystemVerilog — Icarus Verilog simulation', () => {
    it.each<Design>(DESIGNS)(
      '%s: the constant reads as its literal and ignores writes',
      async (design) => {
        if (guardTier1('iverilog', () => toolOnPath('iverilog'))) {
          return;
        }

        const outputDir = await generateRtl(design, 'systemverilog');
        const pkg = path.join(outputDir, 'rtl/ver_core_pkg.sv');
        const regs = path.join(outputDir, 'rtl/ver_core_regs.sv');
        const tb = path.join(FIXTURES_DIR, `${TESTBENCH[design]}.sv`);

        const out = path.join(os.tmpdir(), `ipcraft-iverilog-version-${design}-${process.pid}.vvp`);
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
        expectAllPass(run.stdout + run.stderr);
      }
    );
  });

  describe('bus wrapper of a design whose only register is the version register', () => {
    it('VHDL: pkg, regs, core, wrapper and top analyze and elaborate; the wrapper is not a stub', async () => {
      if (guardTier1('ghdl', () => toolOnPath('ghdl'))) {
        return;
      }

      const outputDir = await generateRtl('only', 'vhdl');
      const files = ['pkg', 'regs', 'core', 'axil', ''].map((part) =>
        path.join(outputDir, `rtl/ver_core${part ? `_${part}` : ''}.vhd`)
      );
      const wrapper = fs.readFileSync(files[3], 'utf8');
      expect(wrapper).toContain('u_regs : entity work.ver_core_regs');
      expect(wrapper).not.toContain('TODO: implement');

      const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-ghdl-version-chain-'));
      try {
        for (const args of [
          ['-a', '--std=08', `--workdir=${workdir}`, ...files],
          ['-e', '--std=08', `--workdir=${workdir}`, 'ver_core'],
        ]) {
          const result = spawnSync('ghdl', args, { encoding: 'utf8', timeout: 60_000 });
          if (result.status !== 0) {
            throw new Error(`ghdl ${args[0]} failed:\n${result.stderr || result.stdout}`);
          }
        }
      } finally {
        fs.rmSync(workdir, { recursive: true, force: true });
      }
    });

    it('SystemVerilog: pkg, regs, core, wrapper and top compile', async () => {
      if (guardTier1('iverilog', () => toolOnPath('iverilog'))) {
        return;
      }

      const outputDir = await generateRtl('only', 'systemverilog');
      const files = ['pkg', 'regs', 'core', 'axil', ''].map((part) =>
        path.join(outputDir, `rtl/ver_core${part ? `_${part}` : ''}.sv`)
      );
      expect(fs.readFileSync(files[3], 'utf8')).toContain('ver_core_regs u_regs (');

      const out = path.join(os.tmpdir(), `ipcraft-iverilog-version-chain-${process.pid}.vvp`);
      const compile = spawnSync('iverilog', ['-g2012', '-s', 'ver_core', '-o', out, ...files], {
        encoding: 'utf8',
        timeout: 60_000,
      });
      fs.rmSync(out, { force: true });
      if (compile.status !== 0) {
        throw new Error(`iverilog compile failed:\n${compile.stderr || compile.stdout}`);
      }
    });
  });
});
