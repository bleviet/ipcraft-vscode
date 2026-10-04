/**
 * A bus interface with no physicalPrefix must mean "no prefix" end to end:
 * unprefixed HDL ports (awaddr, address, ...), an empty cocotb bus prefix, and
 * wrapper-internal signals that do not collide with those ports (they are named
 * <logical>_int). Cases are derived in-test from the shipped examples with the
 * physicalPrefix line removed, then simulated with the generated cocotb
 * testbench (GHDL for VHDL, Icarus for SystemVerilog).
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
const EXAMPLES = path.join(REPO_ROOT, 'ipcraft-spec/examples');

type Lang = 'vhdl' | 'systemverilog';

interface Case {
  label: string;
  example: string;
  /** Ports that must be declared with their bare logical names. */
  ports: string[];
}

const CASES: Case[] = [
  { label: 'AXI4-Lite', example: 'basic_peripheral', ports: ['awaddr', 'wdata', 'rdata'] },
  {
    label: 'Avalon-MM',
    example: 'comprehensive_avalon',
    ports: ['address', 'readdata', 'write_n'],
  },
];

interface Generated {
  outputDir: string;
  top: string;
}

let workDir = '';
const generated = new Map<string, Generated>();

function cocotbAvailable(): boolean {
  const result = spawnSync('python3', ['-c', 'import cocotb'], { encoding: 'utf8' });
  return !result.error && result.status === 0;
}

async function generate(c: Case, lang: Lang): Promise<Generated> {
  const dir = path.join(workDir, `${c.example}_${lang}`);
  fs.mkdirSync(dir, { recursive: true });
  const srcDir = path.join(EXAMPLES, c.example);
  const source = fs.readFileSync(path.join(srcDir, `${c.example}.ip.yml`), 'utf8');
  const stripped = source.replace(/^ {2,4}physicalPrefix: .*\n/m, '');
  expect(stripped).not.toBe(source);
  const yamlPath = path.join(dir, `${c.example}.ip.yml`);
  fs.writeFileSync(yamlPath, stripped);
  fs.copyFileSync(path.join(srcDir, `${c.example}.mm.yml`), path.join(dir, `${c.example}.mm.yml`));

  const silent = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  } as unknown as Logger;
  const loader = new TemplateLoader(silent, path.join(REPO_ROOT, 'src/generator/templates'));
  const scaffolder = new IpCoreScaffolder(silent, loader, devResourceRoots(REPO_ROOT));
  const outputDir = path.join(dir, 'out');
  const result = await scaffolder.generateAll(yamlPath, outputDir, {
    targets: [],
    includeRegs: true,
    includeTestbench: true,
    hdlLanguage: lang,
  });
  expect(result.error).toBeUndefined();
  expect(result.success).toBe(true);
  const ext = lang === 'vhdl' ? 'vhd' : 'sv';
  return { outputDir, top: result.generatedContents?.[`rtl/${c.example}.${ext}`] ?? '' };
}

beforeAll(async () => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-noprefix-'));
  for (const c of CASES) {
    for (const lang of ['vhdl', 'systemverilog'] as const) {
      generated.set(`${c.example}_${lang}`, await generate(c, lang));
    }
  }
}, 600_000);

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe.each(CASES)('prefix-less $label slave', (c) => {
  describe.each([
    { lang: 'vhdl' as const, sim: 'ghdl', tool: 'ghdl' },
    { lang: 'systemverilog' as const, sim: 'icarus', tool: 'iverilog' },
  ])('$lang', ({ lang, sim, tool }) => {
    const get = () => generated.get(`${c.example}_${lang}`)!;

    it('emits unprefixed ports and an empty cocotb bus prefix', () => {
      const { top, outputDir } = get();
      for (const port of c.ports) {
        expect(top).toMatch(new RegExp(`\\b${port}\\b\\s*[:,]|\\blogic\\b[^;,]*\\b${port}\\b`));
      }
      expect(top).not.toMatch(/\bs_axi_\w+/);
      const testPy = fs.readFileSync(path.join(outputDir, `tb/${c.example}_test.py`), 'utf8');
      expect(testPy).not.toContain('from_prefix(dut, "s_axi")');
    });

    it(`passes the generated cocotb testbench under ${sim}`, () => {
      if (guardTier1(tool, () => toolOnPath(tool)) || guardTier1('cocotb', cocotbAvailable)) {
        return;
      }
      const tbDir = path.join(get().outputDir, 'tb');
      const run = spawnSync('make', ['-C', tbDir, `SIM=${sim}`, 'WAVES=0'], {
        encoding: 'utf8',
        timeout: 180_000,
      });
      if (run.status !== 0) {
        throw new Error(
          `cocotb ${sim} failed:\n${run.stdout?.slice(-2500)}\n${run.stderr?.slice(-2500)}`
        );
      }
    });
  });
});
