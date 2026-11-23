/**
 * Word-addressed Avalon-MM slave (`portWidthOverrides: { address: 2 }`).
 *
 * `avs_address` carries a WORD address; the register file decodes BYTE
 * addresses. The wrapper must shift the word address left by log2(bytes per
 * word) and resize it to the register file's address width, whatever the
 * register count (two registers -> C_ADDR_WIDTH 3, three -> 4), and the
 * generated cocotb testbench must drive word addresses to match.
 *
 * Tier 0: rendered-wrapper text. Tier 1: GHDL / Icarus simulation with cocotb
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
const FIXTURES = path.join(__dirname, '../fixtures/avmm-word-address');
const PROBE = path.join(FIXTURES, 'probe/avmm_word_address_probe.py');
const OUTPUT_BASE = path.join(os.tmpdir(), `ipcraft-avmm-word-address-${process.pid}`);

interface Case {
  readonly name: string;
  readonly regCount: number;
  /** Bytes per data word: the byte stride between the probed registers. */
  readonly wordBytes: number;
  /** log2(bytes per word) for a word-addressed port; 0 for a byte-addressed one. */
  readonly addrShift: number;
  /** Expected `address_int` right-hand side in the VHDL wrapper. */
  readonly vhdlAddress: string;
  /** Expected `address_int` right-hand side in the SystemVerilog wrapper. */
  readonly svAddress: string;
}

const CASES: readonly Case[] = [
  {
    name: 'avmm_word_two_regs',
    regCount: 2,
    wordBytes: 4,
    addrShift: 2,
    vhdlAddress: 'std_logic_vector(shift_left(resize(unsigned(avs_address), C_ADDR_WIDTH), 2))',
    svAddress: "C_ADDR_WIDTH'(avs_address) << 2",
  },
  {
    name: 'avmm_word_three_regs',
    regCount: 3,
    wordBytes: 4,
    addrShift: 2,
    vhdlAddress: 'std_logic_vector(shift_left(resize(unsigned(avs_address), C_ADDR_WIDTH), 2))',
    svAddress: "C_ADDR_WIDTH'(avs_address) << 2",
  },
  {
    // A 1-bit port is a scalar std_logic, not a vector: it needs an aggregate.
    name: 'avmm_word_a1_32',
    regCount: 2,
    wordBytes: 4,
    addrShift: 2,
    vhdlAddress:
      "std_logic_vector(shift_left(resize(unsigned'(0 => avs_address), C_ADDR_WIDTH), 2))",
    svAddress: "C_ADDR_WIDTH'(avs_address) << 2",
  },
  {
    // 16-bit data with a 1-bit port reaches only 4 bytes, less than addr_width 3 (8 bytes):
    // the testbench's boundary reads must stay inside what the port can carry.
    name: 'avmm_word_a1_16',
    regCount: 2,
    wordBytes: 2,
    addrShift: 1,
    vhdlAddress:
      "std_logic_vector(shift_left(resize(unsigned'(0 => avs_address), C_ADDR_WIDTH), 1))",
    svAddress: "C_ADDR_WIDTH'(avs_address) << 1",
  },
  {
    name: 'avmm_word_a1_64',
    regCount: 2,
    wordBytes: 8,
    addrShift: 3,
    vhdlAddress:
      "std_logic_vector(shift_left(resize(unsigned'(0 => avs_address), C_ADDR_WIDTH), 3))",
    svAddress: "C_ADDR_WIDTH'(avs_address) << 3",
  },
  {
    name: 'avmm_byte_two_regs',
    regCount: 2,
    wordBytes: 4,
    addrShift: 0,
    vhdlAddress: 'avs_address(C_ADDR_WIDTH-1 downto 0)',
    svAddress: 'avs_address[C_ADDR_WIDTH-1:0]',
  },
];

/** 8-bit data makes the byte-enable port 1 bit wide: a scalar std_logic, not a vector. */
const BYTE_ENABLE_1BIT_CASE: Case = {
  name: 'avmm_byte_two_regs_8',
  regCount: 2,
  wordBytes: 1,
  addrShift: 0,
  vhdlAddress: 'avs_address(C_ADDR_WIDTH-1 downto 0)',
  svAddress: 'avs_address[C_ADDR_WIDTH-1:0]',
};

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

function runMake(tbDir: string, sim: 'ghdl' | 'icarus', extra: string[], env: NodeJS.ProcessEnv) {
  return spawnSync('make', ['-C', tbDir, `SIM=${sim}`, 'WAVES=0', ...extra], {
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, ...env },
  });
}

function failure(label: string, result: ReturnType<typeof runMake>): string {
  return `${label} (exit ${result.status})\n${result.stdout?.slice(-2500) ?? ''}\n${result.stderr?.slice(-1500) ?? ''}`;
}

afterAll(() => {
  fs.rmSync(OUTPUT_BASE, { recursive: true, force: true });
});

describe('Avalon-MM wrapper address conversion (rendered text)', () => {
  it.each(CASES)('VHDL $name builds the byte address from the port', async (testCase) => {
    const dir = await generate(testCase, 'vhdl');
    const wrapper = fs.readFileSync(path.join(dir, `rtl/${testCase.name}_avmm.vhd`), 'utf8');
    expect(wrapper).toContain(`  address_int   <= ${testCase.vhdlAddress};\n`);
    expect(wrapper).not.toMatch(/avs_address & "/);
  });

  it.each(CASES)('SystemVerilog $name builds the byte address from the port', async (testCase) => {
    const dir = await generate(testCase, 'systemverilog');
    const wrapper = fs.readFileSync(path.join(dir, `rtl/${testCase.name}_avmm.sv`), 'utf8');
    expect(wrapper).toContain(`always_comb begin\n    address_int    = ${testCase.svAddress};\n`);
  });
});

describe('Avalon-MM wrapper byte-enable assignment (rendered text)', () => {
  it('VHDL wraps a 1-bit byte-enable port in an aggregate', async () => {
    const dir = await generate(BYTE_ENABLE_1BIT_CASE, 'vhdl');
    const wrapper = fs.readFileSync(path.join(dir, 'rtl/avmm_byte_two_regs_8_avmm.vhd'), 'utf8');
    expect(wrapper).toContain('  byteenable_int <= (0 => avs_byteenable);\n');
  });

  it('VHDL assigns a multi-bit byte-enable port directly', async () => {
    const dir = await generate(CASES[0], 'vhdl');
    const wrapper = fs.readFileSync(path.join(dir, `rtl/${CASES[0].name}_avmm.vhd`), 'utf8');
    expect(wrapper).toContain('  byteenable_int <= avs_byteenable;\n');
  });
});

describe.each([
  { hdl: 'vhdl' as const, sim: 'ghdl' as const, tool: 'ghdl' },
  { hdl: 'systemverilog' as const, sim: 'icarus' as const, tool: 'iverilog' },
])('Avalon-MM word addressing simulation ($sim)', ({ hdl, sim, tool }) => {
  it.each(CASES)('decodes every register at its byte offset: $name', async (testCase) => {
    if (guardTier1(tool, () => toolOnPath(tool)) || guardTier1('cocotb', cocotbAvailable)) {
      return;
    }
    const tbDir = path.join(await generate(testCase, hdl), 'tb');
    fs.copyFileSync(PROBE, path.join(tbDir, path.basename(PROBE)));
    const result = runMake(tbDir, sim, ['MODULE=avmm_word_address_probe'], {
      PROBE_ADDR_SHIFT: String(testCase.addrShift),
      PROBE_WORD_BYTES: String(testCase.wordBytes),
      PROBE_REG_COUNT: String(testCase.regCount),
    });
    if (result.status !== 0) {
      throw new Error(failure(`probe failed for ${testCase.name}`, result));
    }
  });

  it.each(CASES)('generated cocotb testbench passes: $name', async (testCase) => {
    if (guardTier1(tool, () => toolOnPath(tool)) || guardTier1('cocotb', cocotbAvailable)) {
      return;
    }
    const tbDir = path.join(await generate(testCase, hdl), 'tb');
    const result = runMake(tbDir, sim, [], {});
    if (result.status !== 0) {
      throw new Error(failure(`generated testbench failed for ${testCase.name}`, result));
    }
  });
});

describe.each([
  { hdl: 'vhdl' as const, sim: 'ghdl' as const, tool: 'ghdl' },
  { hdl: 'systemverilog' as const, sim: 'icarus' as const, tool: 'iverilog' },
])('Avalon-MM 1-bit byte-enable simulation ($sim)', ({ hdl, sim, tool }) => {
  it('generated cocotb testbench passes: avmm_byte_two_regs_8', async () => {
    if (guardTier1(tool, () => toolOnPath(tool)) || guardTier1('cocotb', cocotbAvailable)) {
      return;
    }
    const tbDir = path.join(await generate(BYTE_ENABLE_1BIT_CASE, hdl), 'tb');
    const result = runMake(tbDir, sim, [], {});
    if (result.status !== 0) {
      throw new Error(failure('generated testbench failed for avmm_byte_two_regs_8', result));
    }
  });
});
