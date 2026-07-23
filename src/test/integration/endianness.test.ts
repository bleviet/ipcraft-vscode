/**
 * Endianness (issue #138): generates a synthetic IP core with a big-endian
 * vector port and a big-endian AXI4-Lite bus data port, and verifies:
 *   - the generated top level declares `_be` intermediate signals and calls
 *     the package's swap_bytes_<width>() function
 *   - the generated RTL compiles under GHDL (VHDL) and Icarus Verilog (SV)
 *
 * This is a self-contained fixture (not part of the shared ipcraft-spec/
 * templates|examples golden-snapshot pipeline in generator.ts) so it does not
 * require updating the committed snapshot files.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { IpCoreScaffolder, collectRtlAbsPaths } from '../../generator/IpCoreScaffolder';
import { TemplateLoader } from '../../generator/TemplateLoader';
import { Logger } from '../../utils/Logger';
import { loadIpCoreData } from '../../generator/loadIpCore';
import { devResourceRoots } from '../../services/ResourceRoots';
import { guardTier1, toolOnPath } from './tier';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const GENERATOR_TEMPLATES = path.join(REPO_ROOT, 'src/generator/templates');
const ENTITY_NAME = 'endian_test_ip';

const IP_YAML = `
vlnv:
  vendor: ipcraft
  library: test
  name: ${ENTITY_NAME}
  version: 1.0.0
description: Synthetic fixture for endianness (issue #138)
scaffold_pack: builtin-ipcraft
parameters:
- name: BUS_DATA_WIDTH
  dataType: integer
  value: 8
clocks:
- name: clk
  direction: in
  associatedReset: reset_n
resets:
- name: reset_n
  direction: in
  polarity: activeLow
  associatedClock: clk
busInterfaces:
- name: s_axi_lite
  type: ipcraft:busif:axi4_lite:1.0
  mode: slave
  physicalPrefix: s_axil_
  associatedClock: clk
  associatedReset: reset_n
  endianness: big
  portWidthOverrides:
    AWADDR: 8
    ARADDR: 8
    WDATA: BUS_DATA_WIDTH
    RDATA: 32
    WSTRB: BUS_DATA_WIDTH
- name: m_axis
  type: ipcraft:busif:axi_stream:1.0
  mode: master
  physicalPrefix: m_axis_
  associatedClock: clk
  associatedReset: reset_n
  endianness: big
  useOptionalPorts:
    - TKEEP
  portWidthOverrides:
    TDATA: BUS_DATA_WIDTH
ports:
- name: data_in
  direction: in
  width: 32
  endianness: big
`;

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Logger;

// A big-endian AXI-Stream master with no memory-mapped slave: the swap has no bus
// wrapper to anchor to, so the top must still instantiate a core to reflow through it
// (issue #138 M4).
const STREAM_ONLY_YAML = `
vlnv:
  vendor: ipcraft
  library: test
  name: stream_only_be
  version: 1.0.0
scaffold_pack: builtin-ipcraft
clocks:
- name: clk
  direction: in
  associatedReset: reset_n
resets:
- name: reset_n
  direction: in
  polarity: activeLow
  associatedClock: clk
busInterfaces:
- name: m_axis
  type: ipcraft:busif:axi_stream:1.0
  mode: master
  physicalPrefix: m_axis_
  associatedClock: clk
  associatedReset: reset_n
  endianness: big
  useOptionalPorts:
    - TKEEP
  portWidthOverrides:
    TDATA: 32
`;

const AVALON_ST_ENDIAN_YAML = `
vlnv:
  vendor: ipcraft
  library: test
  name: avalon_st_endian
  version: 1.0.0
scaffold_pack: builtin-ipcraft
clocks:
- name: clk
  direction: in
  associatedReset: reset_n
resets:
- name: reset_n
  direction: in
  polarity: activeLow
  associatedClock: clk
busInterfaces:
- name: stream_big
  type: ipcraft:busif:avalon_st:1.0
  mode: source
  physicalPrefix: big_
  associatedClock: clk
  associatedReset: reset_n
  endianness: big
- name: stream_little
  type: ipcraft:busif:avalon_st:1.0
  mode: source
  physicalPrefix: little_
  associatedClock: clk
  associatedReset: reset_n
  endianness: little
- name: stream_default
  type: ipcraft:busif:avalon_st:1.0
  mode: source
  physicalPrefix: default_
  associatedClock: clk
  associatedReset: reset_n
`;

async function generate(
  hdlLanguage: 'vhdl' | 'systemverilog',
  yaml: string = IP_YAML,
  targets: Array<'quartus'> = []
) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-endian-'));
  const yamlPath = path.join(outputDir, 'src.ip.yml');
  fs.writeFileSync(yamlPath, yaml);

  const loader = new TemplateLoader(logger, GENERATOR_TEMPLATES);
  const resourceRoots = devResourceRoots(REPO_ROOT);
  const scaffolder = new IpCoreScaffolder(logger, loader, resourceRoots);

  const result = await scaffolder.generateAll(yamlPath, outputDir, {
    targets,
    includeRegs: true,
    hdlLanguage,
  });

  if (!result.success) {
    throw new Error(`Generation failed: ${JSON.stringify(result)}`);
  }

  const ipCoreData = await loadIpCoreData(yamlPath, resourceRoots);
  const absPaths = await collectRtlAbsPaths(
    result.generatedContents ?? {},
    ipCoreData,
    yamlPath,
    outputDir
  );
  // Relative to outputDir (the generation root), e.g. "rtl/endian_test_ip.vhd" —
  // matches the compile-order convention used by hdl.test.ts.
  const rtlOrder = absPaths.map((absPath) => path.relative(outputDir, absPath).replace(/\\/g, '/'));

  return { rootDir: outputDir, rtlDir: path.join(outputDir, 'rtl'), rtlOrder };
}

describe('Endianness code generation (issue #138)', () => {
  it('VHDL: wires _be intermediates and swap_bytes_32 through the top level, and stays out of the core/bus wrapper', async () => {
    const { rtlDir } = await generate('vhdl');

    const topContent = fs.readFileSync(path.join(rtlDir, `${ENTITY_NAME}.vhd`), 'utf8');
    expect(topContent).toContain('s_axil_wdata_be');
    expect(topContent).toContain('s_axil_rdata_be');
    expect(topContent).toContain('data_in_be');
    expect(topContent).toContain('swap_bytes_32(');
    expect(topContent).toContain('gen_swap_m_axis_tdata');
    expect(topContent).toContain("m_axis_tdata'length / 8");
    // The WSTRB / TKEEP byte-qualifiers are bit-reversed in lockstep with the data,
    // and wired to the wrapper/core through their `_be` view (issue #138 H1/H2).
    expect(topContent).toContain('s_axil_wstrb_be');
    expect(topContent).toContain('=> s_axil_wstrb_be');
    expect(topContent).toContain('gen_swap_s_axil_wstrb');
    expect(topContent).toContain('gen_swap_m_axis_tkeep');
    expect(topContent).toContain('generic map (');
    // Parameterized byte swaps guard against a non-byte-multiple elaboration (M3).
    expect(topContent).toContain('mod 8) = 0');

    const pkgContent = fs.readFileSync(path.join(rtlDir, `${ENTITY_NAME}_pkg.vhd`), 'utf8');
    expect(pkgContent).toContain('function swap_bytes_32');

    // Submodules are untouched by endianness: no _be references, no swap calls.
    const coreContent = fs.readFileSync(path.join(rtlDir, `${ENTITY_NAME}_core.vhd`), 'utf8');
    expect(coreContent).not.toContain('_be');
    expect(coreContent).not.toContain('swap_bytes');
    const busContent = fs.readFileSync(path.join(rtlDir, `${ENTITY_NAME}_axil.vhd`), 'utf8');
    expect(busContent).not.toContain('_be');
    expect(busContent).not.toContain('swap_bytes');
  });

  it('SystemVerilog: wires _be intermediates and swap_bytes_32 through the top level, and stays out of the core/bus wrapper', async () => {
    const { rtlDir } = await generate('systemverilog');

    const topContent = fs.readFileSync(path.join(rtlDir, `${ENTITY_NAME}.sv`), 'utf8');
    expect(topContent).toContain('s_axil_wdata_be');
    expect(topContent).toContain('s_axil_rdata_be');
    expect(topContent).toContain('data_in_be');
    expect(topContent).toContain('swap_bytes_32(');
    expect(topContent).toContain('gen_swap_m_axis_tdata');
    expect(topContent).toContain('$bits(m_axis_tdata) / 8');
    expect(topContent).toContain('($bits(m_axis_tdata) % 8) == 0');
    // Byte-qualifiers bit-reversed in lockstep and wired through `_be` (issue #138 H1/H2).
    expect(topContent).toContain('s_axil_wstrb_be');
    expect(topContent).toContain('(s_axil_wstrb_be)');
    expect(topContent).toContain('gen_swap_s_axil_wstrb');
    expect(topContent).toContain('gen_swap_m_axis_tkeep');
    expect(topContent).toContain('endian_test_ip_axil #(');

    const pkgContent = fs.readFileSync(path.join(rtlDir, `${ENTITY_NAME}_pkg.sv`), 'utf8');
    expect(pkgContent).toContain('function automatic logic [31:0] swap_bytes_32');

    const coreContent = fs.readFileSync(path.join(rtlDir, `${ENTITY_NAME}_core.sv`), 'utf8');
    expect(coreContent).not.toContain('_be');
    expect(coreContent).not.toContain('swap_bytes');
    const busContent = fs.readFileSync(path.join(rtlDir, `${ENTITY_NAME}_axil.sv`), 'utf8');
    expect(busContent).not.toContain('_be');
    expect(busContent).not.toContain('swap_bytes');
  });

  it('GHDL: the generated VHDL compiles and elaborates', async () => {
    if (guardTier1('ghdl', () => toolOnPath('ghdl'))) {
      return;
    }

    const { rootDir, rtlOrder } = await generate('vhdl');
    const ordered = rtlOrder.filter((f) => f.endsWith('.vhd'));

    const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-ghdl-endian-'));
    try {
      const steps: string[][] = [
        ['-a', '--std=08', `--workdir=${workdir}`, ...ordered],
        ['-e', '--std=08', `--workdir=${workdir}`, ENTITY_NAME],
      ];
      for (const args of steps) {
        const result = spawnSync('ghdl', args, {
          cwd: rootDir,
          encoding: 'utf8',
          timeout: 120_000,
        });
        expect({ status: result.status, output: result.stderr || result.stdout }).toEqual({
          status: 0,
          output: result.stderr || result.stdout,
        });
      }
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
    }
  }, 60_000);

  it('Icarus Verilog: the generated SystemVerilog compiles', async () => {
    if (guardTier1('iverilog', () => toolOnPath('iverilog'))) {
      return;
    }

    const { rootDir, rtlOrder } = await generate('systemverilog');
    const ordered = rtlOrder.filter((f) => f.endsWith('.sv'));

    const out = path.join(os.tmpdir(), `ipcraft-iverilog-endian-${process.pid}.vvp`);
    const result = spawnSync('iverilog', ['-g2012', '-o', out, ...ordered], {
      cwd: rootDir,
      encoding: 'utf8',
      timeout: 120_000,
    });
    fs.rmSync(out, { force: true });

    expect({ status: result.status, output: result.stderr || result.stdout }).toEqual({
      status: 0,
      output: result.stderr || result.stdout,
    });
  }, 60_000);
});

describe('Avalon-ST Platform Designer endianness metadata (issue #145)', () => {
  it('derives firstSymbolInHighOrderBits for big, little, and omitted endianness', async () => {
    const { rootDir } = await generate('vhdl', AVALON_ST_ENDIAN_YAML, ['quartus']);
    const tcl = fs.readFileSync(path.join(rootDir, 'altera', 'avalon_st_endian_hw.tcl'), 'utf8');

    expect(tcl).toContain('set_interface_property stream_big firstSymbolInHighOrderBits true');
    expect(tcl).toContain('set_interface_property stream_little firstSymbolInHighOrderBits false');
    expect(tcl).toContain('set_interface_property stream_default firstSymbolInHighOrderBits false');
  });
});

describe('Endianness on a stream-only IP with no memory-mapped slave (issue #138 M4)', () => {
  it('VHDL: instantiates a core and reflows the swap through it (no bus wrapper)', async () => {
    const { rtlDir } = await generate('vhdl', STREAM_ONLY_YAML);

    // A core and package are generated even though there is no memory-mapped slave...
    expect(fs.existsSync(path.join(rtlDir, 'stream_only_be_core.vhd'))).toBe(true);
    expect(fs.existsSync(path.join(rtlDir, 'stream_only_be_pkg.vhd'))).toBe(true);
    // ...and no bus wrapper is emitted.
    expect(fs.existsSync(path.join(rtlDir, 'stream_only_be_axil.vhd'))).toBe(false);

    const top = fs.readFileSync(path.join(rtlDir, 'stream_only_be.vhd'), 'utf8');
    expect(top).toContain('u_core : entity work.stream_only_be_core');
    expect(top).not.toContain('Bus Wrapper Instance');
    expect(top).toContain('m_axis_tdata <= swap_bytes_32(m_axis_tdata_be)');
    expect(top).toContain('gen_swap_m_axis_tkeep');
    expect(top).toContain('m_axis_tdata   => m_axis_tdata_be');
  });

  it('GHDL + iverilog: the generated RTL compiles', async () => {
    if (!guardTier1('ghdl', () => toolOnPath('ghdl'))) {
      const { rootDir, rtlOrder } = await generate('vhdl', STREAM_ONLY_YAML);
      const ordered = rtlOrder.filter((f) => f.endsWith('.vhd'));
      const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-ghdl-so-'));
      try {
        for (const args of [
          ['-a', '--std=08', `--workdir=${workdir}`, ...ordered],
          ['-e', '--std=08', `--workdir=${workdir}`, 'stream_only_be'],
        ]) {
          const r = spawnSync('ghdl', args, { cwd: rootDir, encoding: 'utf8', timeout: 120_000 });
          expect({ status: r.status, out: r.stderr || r.stdout }).toEqual({
            status: 0,
            out: r.stderr || r.stdout,
          });
        }
      } finally {
        fs.rmSync(workdir, { recursive: true, force: true });
      }
    }

    if (!guardTier1('iverilog', () => toolOnPath('iverilog'))) {
      const { rootDir, rtlOrder } = await generate('systemverilog', STREAM_ONLY_YAML);
      const ordered = rtlOrder.filter((f) => f.endsWith('.sv'));
      const out = path.join(os.tmpdir(), `ipcraft-iverilog-so-${process.pid}.vvp`);
      const r = spawnSync('iverilog', ['-g2012', '-o', out, ...ordered], {
        cwd: rootDir,
        encoding: 'utf8',
        timeout: 120_000,
      });
      fs.rmSync(out, { force: true });
      expect({ status: r.status, out: r.stderr || r.stdout }).toEqual({
        status: 0,
        out: r.stderr || r.stdout,
      });
    }
  }, 90_000);
});
