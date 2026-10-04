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
  value: 32
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
    RDATA: BUS_DATA_WIDTH
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

const FIVE_BIT_AVALON_ST_YAML = `
vlnv:
  vendor: ipcraft
  library: test
  name: five_bit_avalon_st
  version: 1.0.0
scaffold_pack: builtin-ipcraft
busInterfaces:
- name: symbol_stream
  type: ipcraft:busif:avalon_st:1.0
  mode: source
  physicalPrefix: symbol_stream_
  endianness: big
  portWidthOverrides:
    data: 5
  interfaceProperties:
    dataBitsPerSymbol: 1
    symbolsPerBeat: 5
    readyLatency: 0
`;

const PARAMETERIZED_SYMBOL_YAML = `
vlnv:
  vendor: ipcraft
  library: test
  name: param_symbol
  version: 1.0.0
scaffold_pack: builtin-ipcraft
parameters:
- name: SYMBOL_W
  dataType: integer
  value: 8
- name: DATA_W
  dataType: integer
  value: 32
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
- name: stream
  type: ipcraft:busif:avalon_st:1.0
  mode: source
  physicalPrefix: stream_
  associatedClock: clk
  associatedReset: reset_n
  endianness: big
  portWidthOverrides:
    data: DATA_W
  interfaceProperties:
    dataBitsPerSymbol: SYMBOL_W
`;

async function generate(
  hdlLanguage: 'vhdl' | 'systemverilog',
  yaml: string = IP_YAML,
  targets: Array<'quartus' | 'vivado'> = []
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
  it('reverses a five-bit Avalon-ST payload in one-bit lanes without a byte guard', async () => {
    const vhdl = await generate('vhdl', FIVE_BIT_AVALON_ST_YAML);
    const vhdlTop = fs.readFileSync(path.join(vhdl.rtlDir, 'five_bit_avalon_st.vhd'), 'utf8');
    expect(vhdlTop).toContain("symbol_stream_data'length / 1");
    expect(vhdlTop).toContain('lane_idx * 1');
    expect(vhdlTop).not.toContain("symbol_stream_data'length mod 8");

    const systemVerilog = await generate('systemverilog', FIVE_BIT_AVALON_ST_YAML);
    const svTop = fs.readFileSync(path.join(systemVerilog.rtlDir, 'five_bit_avalon_st.sv'), 'utf8');
    expect(svTop).toContain('$bits(symbol_stream_data) / 1');
    expect(svTop).toContain('lane_idx_symbol_stream_data * 1 +: 1');
    expect(svTop).not.toContain('$bits(symbol_stream_data) % 8');
  });

  it('keeps a parameterized dataBitsPerSymbol symbolic in lanes and exports', async () => {
    const vhdl = await generate('vhdl', PARAMETERIZED_SYMBOL_YAML, ['quartus', 'vivado']);
    const vhdlTop = fs.readFileSync(path.join(vhdl.rtlDir, 'param_symbol.vhd'), 'utf8');
    expect(vhdlTop).toContain("stream_data'length / SYMBOL_W");
    expect(vhdlTop).toContain('lane_idx * SYMBOL_W');
    expect(vhdlTop).not.toContain('swap_bytes');

    const systemVerilog = await generate('systemverilog', PARAMETERIZED_SYMBOL_YAML);
    const svTop = fs.readFileSync(path.join(systemVerilog.rtlDir, 'param_symbol.sv'), 'utf8');
    expect(svTop).toContain('$bits(stream_data) / SYMBOL_W');
    expect(svTop).not.toContain('swap_bytes');

    const tcl = fs.readFileSync(path.join(vhdl.rootDir, 'altera', 'param_symbol_hw.tcl'), 'utf8');
    const elaborate = tcl.slice(tcl.indexOf('proc elaborate'));
    expect(tcl).toContain('set_interface_property stream dataBitsPerSymbol 8');
    expect(elaborate).toContain(
      'set_interface_property stream dataBitsPerSymbol [get_parameter_value SYMBOL_W]'
    );
    expect(elaborate).toContain(
      'set_interface_property stream symbolsPerBeat [expr [get_parameter_value DATA_W]/[get_parameter_value SYMBOL_W]]'
    );

    const xml = fs.readFileSync(path.join(vhdl.rootDir, 'xilinx', 'component.xml'), 'utf8');
    const param = xml.slice(xml.indexOf('<spirit:name>dataBitsPerSymbol</spirit:name>'));
    const dataBitsParam = param.slice(0, param.indexOf('</spirit:parameter>'));
    expect(dataBitsParam).toContain('spirit:resolve="dependent"');
    expect(dataBitsParam).toContain('MODELPARAM_VALUE.SYMBOL_W');
    expect(dataBitsParam).toContain('>8</spirit:value>');
  });

  it('emits the elaborate callback when only interface properties are parameterized', async () => {
    const fixedWidth = PARAMETERIZED_SYMBOL_YAML.replace('    data: DATA_W\n', '    data: 32\n');
    const { rootDir } = await generate('vhdl', fixedWidth, ['quartus']);
    const tcl = fs.readFileSync(path.join(rootDir, 'altera', 'param_symbol_hw.tcl'), 'utf8');

    expect(tcl).toContain('set_module_property ELABORATION_CALLBACK elaborate');
    expect(tcl).toContain(
      'set_interface_property stream dataBitsPerSymbol [get_parameter_value SYMBOL_W]'
    );
    expect(tcl).toContain(
      'set_interface_property stream symbolsPerBeat [expr 32/[get_parameter_value SYMBOL_W]]'
    );
  });

  it('does not set elaborate properties on an interface whose static properties are not emitted', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-conduit-prop-'));
    fs.mkdirSync(path.join(rootDir, 'bus_definitions'));
    fs.writeFileSync(
      path.join(rootDir, 'bus_definitions', 'sized_conduit.yml'),
      `SIZED_CONDUIT:
  busType:
    vendor: acme
    library: busif
    name: sized_conduit
    version: '1.0'
  contract:
    version: 1
    interfaceKind: conduit
    modePolicy:
      producer: master
      consumer: slave
      aliases: {}
    interfaceProperties:
      depth:
        type: integer
        minimum: 1
    constraints: []
  ports:
  - name: payload
    width: 8
    direction: out
    presence: required
    role: control
    widthPolicy: fixed
`
    );
    const yamlPath = path.join(rootDir, 'src.ip.yml');
    fs.writeFileSync(
      yamlPath,
      `vlnv:
  vendor: ipcraft
  library: test
  name: sized_conduit_ip
  version: 1.0.0
scaffold_pack: builtin-ipcraft
useBusLibrary: ./bus_definitions
parameters:
- name: DEPTH_P
  dataType: integer
  value: 4
busInterfaces:
- name: sc
  type: acme:busif:sized_conduit:1.0
  mode: master
  physicalPrefix: sc_
  interfaceProperties:
    depth: DEPTH_P
`
    );
    const scaffolder = new IpCoreScaffolder(
      logger,
      new TemplateLoader(logger, GENERATOR_TEMPLATES),
      devResourceRoots(REPO_ROOT)
    );
    const result = await scaffolder.generateAll(yamlPath, rootDir, {
      targets: ['quartus'],
      includeRegs: true,
      hdlLanguage: 'vhdl',
    });
    expect(result.success).toBe(true);
    const tcl = fs.readFileSync(path.join(rootDir, 'altera', 'sized_conduit_ip_hw.tcl'), 'utf8');

    expect(tcl).not.toContain('set_interface_property sc depth');
    expect(tcl).not.toContain('ELABORATION_CALLBACK');
    expect(tcl).not.toContain('proc elaborate');
  });

  it('compiles a parameterized symbol lane under GHDL and Icarus Verilog', async () => {
    if (!guardTier1('ghdl', () => toolOnPath('ghdl'))) {
      const { rootDir, rtlOrder } = await generate('vhdl', PARAMETERIZED_SYMBOL_YAML);
      const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-ghdl-symbol-'));
      try {
        const analyze = spawnSync(
          'ghdl',
          ['-a', '--std=08', `--workdir=${workdir}`, ...rtlOrder.filter((f) => f.endsWith('.vhd'))],
          { cwd: rootDir, encoding: 'utf8', timeout: 120_000 }
        );
        expect({ status: analyze.status, output: analyze.stderr }).toEqual({
          status: 0,
          output: analyze.stderr,
        });
        const elaborate = spawnSync(
          'ghdl',
          ['-e', '--std=08', `--workdir=${workdir}`, '-gSYMBOL_W=16', 'param_symbol'],
          { cwd: rootDir, encoding: 'utf8', timeout: 120_000 }
        );
        expect({ status: elaborate.status, output: elaborate.stderr }).toEqual({
          status: 0,
          output: elaborate.stderr,
        });
      } finally {
        fs.rmSync(workdir, { recursive: true, force: true });
      }
    }
    if (!guardTier1('iverilog', () => toolOnPath('iverilog'))) {
      const { rootDir, rtlOrder } = await generate('systemverilog', PARAMETERIZED_SYMBOL_YAML);
      const out = path.join(os.tmpdir(), `ipcraft-iverilog-symbol-${process.pid}.vvp`);
      const result = spawnSync(
        'iverilog',
        ['-g2012', '-o', out, ...rtlOrder.filter((f) => f.endsWith('.sv'))],
        { cwd: rootDir, encoding: 'utf8', timeout: 120_000 }
      );
      fs.rmSync(out, { force: true });
      expect({ status: result.status, output: result.stderr }).toEqual({
        status: 0,
        output: result.stderr,
      });
    }
  }, 120_000);

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

describe('Generation source snapshots (issue #195)', () => {
  it('uses current editor YAML while resolving imported resources from the original IP directory', async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-generation-snapshot-'));
    const yamlPath = path.join(rootDir, 'preview_endian.ip.yml');
    const busLibraryDir = path.join(rootDir, 'bus_definitions');
    const userRtlDir = path.join(rootDir, 'user_rtl');
    fs.mkdirSync(busLibraryDir);
    fs.mkdirSync(userRtlDir);

    const diskYaml = `
vlnv:
  vendor: ipcraft
  library: example
  name: preview_endian
  version: 1.0.0
scaffold_pack: builtin-minimal
clocks:
  - name: clk
    direction: in
resets:
  - name: reset_n
    direction: in
    polarity: activeLow
busInterfaces:
  - name: avl_st
    type: ipcraft:busif:avalon_st:1.0
    mode: source
    physicalPrefix: avl_st_
    associatedClock: clk
    associatedReset: reset_n
    endianness: big
`;
    const editorYaml = `
vlnv:
  vendor: ipcraft
  library: example
  name: preview_endian
  version: 1.0.0
scaffold_pack: builtin-ipcraft
useBusLibrary: ./bus_definitions
clocks:
  - name: clk
    direction: in
resets:
  - name: reset_n
    direction: in
    polarity: activeLow
busInterfaces:
  - name: avl_st
    type: ipcraft:busif:avalon_st:1.0
    mode: source
    physicalPrefix: avl_st_
    associatedClock: clk
    associatedReset: reset_n
    endianness: little
  - name: csr
    type: ipcraft:busif:avalon_mm:1.0
    mode: slave
    physicalPrefix: csr_
    associatedClock: clk
    associatedReset: reset_n
    memoryMapRef: MAP
memoryMaps:
  import: preview_endian.mm.yml
fileSets:
  - name: RTL_Sources
    files:
      - path: user_rtl/kept_relative.vhd
        type: vhdl
        managed: false
`;
    fs.writeFileSync(yamlPath, diskYaml);
    fs.writeFileSync(
      path.join(rootDir, 'preview_endian.mm.yml'),
      `
- name: MAP
  addressBlocks:
    - name: REGS
      baseAddress: 0
      usage: register
      registers:
        - name: SNAPSHOT_CTRL
          fields:
            - name: ENABLE
              bits: '[0:0]'
              access: read-write
`
    );
    fs.writeFileSync(
      path.join(busLibraryDir, 'avalon_st.yml'),
      fs
        .readFileSync(path.join(REPO_ROOT, 'ipcraft-spec/bus_definitions/avalon_st.yml'), 'utf8')
        .replace('width: 32', 'width: 64')
    );
    const userRtl = '-- relative file-set source\n';
    fs.writeFileSync(path.join(userRtlDir, 'kept_relative.vhd'), userRtl);

    const scaffolder = new IpCoreScaffolder(
      logger,
      new TemplateLoader(logger, GENERATOR_TEMPLATES),
      devResourceRoots(REPO_ROOT)
    );
    const result = await scaffolder.generateAll(yamlPath, rootDir, {
      sourceText: editorYaml,
      targets: ['quartus'],
      includeTestbench: false,
      includeDocs: true,
      hdlLanguage: 'vhdl',
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.resolvedPackName).toBe('builtin-ipcraft');
    expect(result.generatedContents?.['altera/preview_endian_hw.tcl']).toContain(
      'set_interface_property avl_st firstSymbolInHighOrderBits false'
    );
    expect(result.generatedContents?.['rtl/preview_endian.vhd']).toMatch(
      /avl_st_data\s+: out std_logic_vector\(63 downto 0\)/
    );
    expect(result.generatedContents?.['docs/preview_endian_datasheet.md']).toContain(
      'SNAPSHOT_CTRL'
    );
    expect(result.generatedContents?.['user_rtl/kept_relative.vhd']).toBe(userRtl);
    expect(fs.readFileSync(yamlPath, 'utf8')).toBe(diskYaml);
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

describe('Endianness on a big-endian Avalon-ST source with eight-bit symbols', () => {
  it('declares swap_bytes_32 in the package that the top level calls', async () => {
    const { rtlDir } = await generate('vhdl', AVALON_ST_ENDIAN_YAML);
    const top = fs.readFileSync(path.join(rtlDir, 'avalon_st_endian.vhd'), 'utf8');
    const pkg = fs.readFileSync(path.join(rtlDir, 'avalon_st_endian_pkg.vhd'), 'utf8');
    expect(top).toContain('big_data <= swap_bytes_32(big_data_be);');
    expect(pkg).toContain('function swap_bytes_32');
  });

  it('GHDL + iverilog: the generated RTL compiles', async () => {
    if (!guardTier1('ghdl', () => toolOnPath('ghdl'))) {
      const { rootDir, rtlOrder } = await generate('vhdl', AVALON_ST_ENDIAN_YAML);
      const ordered = rtlOrder.filter((f) => f.endsWith('.vhd'));
      const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-ghdl-avst-'));
      try {
        for (const args of [
          ['-a', '--std=08', `--workdir=${workdir}`, ...ordered],
          ['-e', '--std=08', `--workdir=${workdir}`, 'avalon_st_endian'],
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
      const { rootDir, rtlOrder } = await generate('systemverilog', AVALON_ST_ENDIAN_YAML);
      const ordered = rtlOrder.filter((f) => f.endsWith('.sv'));
      const out = path.join(os.tmpdir(), `ipcraft-iverilog-avst-${process.pid}.vvp`);
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

const ONE_LANE_PARAMETERIZED_YAML = `
vlnv:
  vendor: ipcraft
  library: test
  name: one_lane_be
  version: 1.0.0
scaffold_pack: builtin-ipcraft
parameters:
- name: C_W
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
- name: m_axis
  type: ipcraft:busif:axi_stream:1.0
  mode: master
  physicalPrefix: m_axis_
  associatedClock: clk
  associatedReset: reset_n
  endianness: big
  portWidthOverrides:
    TDATA: C_W
`;

describe('Endianness on a parameterized big-endian payload that is exactly one lane wide', () => {
  it('GHDL + iverilog: the lane-swap width check passes at run time', async () => {
    if (!guardTier1('ghdl', () => toolOnPath('ghdl'))) {
      const { rootDir, rtlOrder } = await generate('vhdl', ONE_LANE_PARAMETERIZED_YAML);
      const ordered = rtlOrder.filter((f) => f.endsWith('.vhd'));
      const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-ghdl-onelane-'));
      try {
        for (const args of [
          ['-a', '--std=08', `--workdir=${workdir}`, ...ordered],
          ['-e', '--std=08', `--workdir=${workdir}`, 'one_lane_be'],
          ['-r', '--std=08', `--workdir=${workdir}`, 'one_lane_be', '--stop-time=0ns'],
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
      const { rootDir, rtlOrder } = await generate('systemverilog', ONE_LANE_PARAMETERIZED_YAML);
      const ordered = rtlOrder.filter((f) => f.endsWith('.sv'));
      const out = path.join(os.tmpdir(), `ipcraft-iverilog-onelane-${process.pid}.vvp`);
      try {
        const compile = spawnSync(
          'iverilog',
          ['-g2012', '-s', 'one_lane_be', '-o', out, ...ordered],
          { cwd: rootDir, encoding: 'utf8', timeout: 120_000 }
        );
        expect({ status: compile.status, out: compile.stderr || compile.stdout }).toEqual({
          status: 0,
          out: compile.stderr || compile.stdout,
        });
        const run = spawnSync('vvp', ['-n', out], { encoding: 'utf8', timeout: 120_000 });
        expect(run.stdout + run.stderr).not.toMatch(/FATAL|lane swap requires/);
      } finally {
        fs.rmSync(out, { force: true });
      }
    }
  }, 90_000);
});
