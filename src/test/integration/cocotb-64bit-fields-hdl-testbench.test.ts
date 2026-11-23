/**
 * Fields wider than 32 bits (ipcraft-vscode#321).
 *
 * The verification manifest used 32-bit arithmetic, so the generated cocotb
 * scoreboard compared only the low word of a `[63:0]` field
 * (`expected 0x1DD377B5, got 0xE1DD92B11DD377B5`) while the RTL was correct.
 * The generated testbench must now pass against the generated RTL on a 64-bit
 * AXI4-Lite and a 64-bit Avalon-MM slave.
 *
 * Tier 0: manifest text. Tier 1: GHDL / Icarus simulation with cocotb
 * (self-skips per tier.ts when a tool is missing).
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

type Hdl = 'vhdl' | 'systemverilog';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const GENERATOR_TEMPLATES = path.join(REPO_ROOT, 'src/generator/templates');
const FIXTURES = path.join(__dirname, '../fixtures/cocotb-64bit-fields');
const OUTPUT_BASE = path.join(os.tmpdir(), `ipcraft-cocotb-64bit-fields-${process.pid}`);

const CASES = [{ name: 'cocotb_64bit_axil' }, { name: 'cocotb_64bit_avmm' }] as const;
type Case = (typeof CASES)[number];

async function generate(testCase: Case, hdlLanguage: Hdl): Promise<string> {
  const outputDir = path.join(OUTPUT_BASE, `${testCase.name}_${hdlLanguage}`);
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
  const result = await scaffolder.generateAll(
    path.join(FIXTURES, `${testCase.name}.ip.yml`),
    outputDir,
    {
      targets: [],
      includeRegs: true,
      includeTestbench: true,
      includeVivadoProject: false,
      includeQuartusProject: false,
      hdlLanguage,
    }
  );
  if (!result.success) {
    throw new Error(`Generation failed for ${testCase.name}/${hdlLanguage}: ${result.error}`);
  }
  return outputDir;
}

function cocotbAvailable(): boolean {
  const result = spawnSync('python3', ['-c', 'import cocotb'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

function runMake(tbDir: string, sim: 'ghdl' | 'icarus') {
  return spawnSync('make', ['-C', tbDir, `SIM=${sim}`, 'WAVES=0'], {
    encoding: 'utf8',
    timeout: 120_000,
  });
}

function failure(label: string, result: ReturnType<typeof runMake>): string {
  return `${label} (exit ${result.status})\n${result.stdout?.slice(-2500) ?? ''}\n${result.stderr?.slice(-1500) ?? ''}`;
}

afterAll(() => {
  fs.rmSync(OUTPUT_BASE, { recursive: true, force: true });
});

describe('verification manifest for fields wider than 32 bits (text)', () => {
  it.each(CASES)('$name keeps every bit of the 64-bit masks and resets', async (testCase) => {
    const dir = await generate(testCase, 'vhdl');
    const text = fs.readFileSync(path.join(dir, 'tb/verification_manifest.json'), 'utf8');
    // 0xFFFFFFFFFFFFFFFF, 0xFFFFFFFF00000000, 0x100000000 as exact JSON integers.
    expect(text).toContain('"mask": 18446744073709551615,');
    expect(text).toContain('"mask": 18446744069414584320,');
    expect(text).toContain('"resetValue": 4294967386,');
  });
});

describe.each([
  { hdl: 'vhdl' as const, sim: 'ghdl' as const, tool: 'ghdl' },
  { hdl: 'systemverilog' as const, sim: 'icarus' as const, tool: 'iverilog' },
])('generated cocotb testbench with 64-bit fields ($sim)', ({ hdl, sim, tool }) => {
  it.each(CASES)('passes: $name', async (testCase) => {
    if (guardTier1(tool, () => toolOnPath(tool)) || guardTier1('cocotb', cocotbAvailable)) {
      return;
    }
    const tbDir = path.join(await generate(testCase, hdl), 'tb');
    const result = runMake(tbDir, sim);
    if (result.status !== 0) {
      throw new Error(failure(`generated testbench failed for ${testCase.name}`, result));
    }
  });
});
