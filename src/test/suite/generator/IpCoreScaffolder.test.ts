/* eslint-disable */
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fs2 from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { IpCoreScaffolder } from '../../../generator/IpCoreScaffolder';
import { TemplateLoader } from '../../../generator/TemplateLoader';
import { Logger } from '../../../utils/Logger';
import { BusLibraryService } from '../../../services/BusLibraryService';
import { devResourceRoots } from '../../../services/ResourceRoots';

// Mock Logger
jest.mock('../../../utils/Logger', () => {
  return {
    Logger: jest.fn().mockImplementation(() => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    })),
  };
});

// Mock BusLibraryService
jest.mock('../../../services/BusLibraryService', () => {
  return {
    BusLibraryService: jest.fn().mockImplementation(() => ({
      loadDefaultLibrary: jest.fn().mockResolvedValue({
        AXI4L: { ports: [{ name: 'AWADDR', presence: 'required' }] },
      }),
      clearCache: jest.fn(),
    })),
  };
});

// Mock fs/promises for writing, but keep readFile for fixtures
jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return {
    ...actual,
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
  };
});

// Mock the Vivado interface cache lookup used by ensureBusDefinitions().
const mockVivadoPathExists = jest.fn().mockResolvedValue(false);
jest.mock('../../../services/VivadoInterfaceScanner', () => ({
  getVivadoInterfaceCacheDir: () => '/fake/vivado/cache/bus_definitions',
  pathExists: (p: string) => mockVivadoPathExists(p),
}));

// Mock WorkspaceBusDefinitionScanner used by ensureBusDefinitions().
const mockWorkspaceScan = jest.fn().mockResolvedValue({ library: {}, files: [], count: 0 });
jest.mock('../../../services/WorkspaceBusDefinitionScanner', () => ({
  getWorkspaceBusDefinitionScanner: () => ({ scan: mockWorkspaceScan }),
}));

describe('IpCoreScaffolder', () => {
  let scaffolder: any;
  const logger = new Logger('test');
  const templatesPath = path.resolve(__dirname, '../../../generator/templates');
  const loader = new TemplateLoader(logger, templatesPath);

  const repoRoot = path.resolve(__dirname, '../../../..');
  const resourceRoots = devResourceRoots(repoRoot);

  beforeEach(() => {
    // resetMocks: true in jest.config resets all mock implementations before each test.
    // Re-apply the BusLibraryService mock implementation before constructing the scaffolder.
    (BusLibraryService as jest.Mock).mockImplementation(() => ({
      loadDefaultLibrary: jest.fn().mockResolvedValue({
        AXI4L: { ports: [{ name: 'AWADDR', presence: 'required' }] },
      }),
      clearCache: jest.fn(),
    }));
    mockVivadoPathExists.mockResolvedValue(false);
    mockWorkspaceScan.mockResolvedValue({ library: {}, files: [], count: 0 });
    scaffolder = new IpCoreScaffolder(logger, loader, resourceRoots);
    jest.clearAllMocks();
  });

  it('generates a full project structure (builtin-ipcraft)', async () => {
    const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
    const outputDir = '/tmp/test-output';

    const result = await scaffolder.generateAll(inputPath, outputDir, {
      includeRegs: true,
      includeTestbench: true,
      targets: ['vivado', 'quartus'],
      scaffoldPack: 'builtin-ipcraft',
    });

    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThan(5);

    // Verify specific files were "written"
    const writtenFiles = (fs.writeFile as unknown as jest.Mock).mock.calls.map((call) => call[0]);
    expect(writtenFiles.some((f) => f.includes('rtl/sample_core.vhd'))).toBe(true);
    expect(writtenFiles.some((f) => f.includes('rtl/sample_core_regs.vhd'))).toBe(true);
    expect(writtenFiles.some((f) => f.includes('tb/Makefile'))).toBe(true);
    expect(writtenFiles.some((f) => f.includes('altera/sample_core_hw.tcl'))).toBe(true);
    expect(writtenFiles.some((f) => f.includes('xilinx/component.xml'))).toBe(true);

    // Verify content of one file
    const vhdlContent = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
      call[0].includes('rtl/sample_core.vhd')
    )?.[1];
    expect(vhdlContent).toContain('entity sample_core is');

    // Verify altera hw.tcl maps bus interface types correctly (not 'unknown')
    const tclContent = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
      call[0].includes('altera/sample_core_hw.tcl')
    )?.[1];
    expect(tclContent).toContain('add_interface S_AXI axi4lite');
    expect(tclContent).not.toContain('add_interface S_AXI unknown');
    expect(tclContent).toContain(
      'set_parameter_property DATA_WIDTH DESCRIPTION "Width of the data bus"'
    );
    expect(tclContent).toContain('set_parameter_property ADDR_WIDTH ALLOWED_RANGES 16:64');
    expect(tclContent).toContain('set_parameter_property DATA_WIDTH ALLOWED_RANGES { 8 16 32 64 }');

    // Verify Vivado component.xml contains parameter description and choices
    const xmlContent = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
      call[0].includes('xilinx/component.xml')
    )?.[1];
    expect(xmlContent).toContain('<spirit:description>Width of the data bus</spirit:description>');
    expect(xmlContent).toContain('spirit:choiceRef="choice_DATA_WIDTH"');
    expect(xmlContent).toContain('<spirit:name>choice_DATA_WIDTH</spirit:name>');
    expect(xmlContent).toContain('<spirit:enumeration>32</spirit:enumeration>');

    // Vivado xGUI: parameter descriptions surface as customize-dialog tooltips
    const xguiContent = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
      call[0].includes('xilinx/xgui/sample_core_v1_0_0.tcl')
    )?.[1];
    expect(xguiContent).toContain(
      'set DATA_WIDTH [ipgui::add_param $IPINST -name "DATA_WIDTH" -parent ${Page_Page_0}]'
    );
    expect(xguiContent).toContain('set_property tooltip {Width of the data bus} ${DATA_WIDTH}');
    expect(xguiContent).toContain('set_property tooltip {Vendor identifier} ${VENDOR_ID}');
    // Parameters without a description are added without a tooltip line
    expect(xguiContent).toContain('ipgui::add_param $IPINST -name "ADDR_WIDTH"');
    expect(xguiContent).not.toMatch(/set_property tooltip .* \$\{ADDR_WIDTH\}/);

    // String generics: VHDL must use quoted string literals
    expect(vhdlContent).toContain('VENDOR_ID : string := "ACME"');
    expect(vhdlContent).toContain('DEVICE_TAG : string := ""');

    // String generics: component.xml must use raw (unquoted) values
    expect(xmlContent).toContain('spirit:format="string"');
    const vendorIdValueMatch = xmlContent?.match(
      /PARAM_VALUE\.VENDOR_ID[^>]*>([^<]*)<\/spirit:value>/
    );
    expect(vendorIdValueMatch?.[1]).toBe('ACME');

    // String generics: Altera hw.tcl must use quoted string literals (valid TCL)
    expect(tclContent).toContain('add_parameter VENDOR_ID STRING "ACME"');
    expect(tclContent).toContain('add_parameter DEVICE_TAG STRING ""');
  });

  it('generates a single minimal stub by default (builtin-minimal)', async () => {
    const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
    const outputDir = '/tmp/test-minimal-output';

    const result = await scaffolder.generateAll(inputPath, outputDir, {
      includeRegs: true,
      includeTestbench: true,
      targets: ['vivado', 'quartus'],
      // builtin-minimal is the default
    });

    expect(result.success).toBe(true);

    const writtenFiles = (fs.writeFile as unknown as jest.Mock).mock.calls.map((call) => call[0]);

    // Only the single top-level stub should be present — no sub-module files
    expect(writtenFiles.some((f: string) => f.includes('rtl/sample_core.vhd'))).toBe(true);
    expect(writtenFiles.some((f: string) => f.includes('rtl/sample_core_pkg.vhd'))).toBe(false);
    expect(writtenFiles.some((f: string) => f.includes('rtl/sample_core_regs.vhd'))).toBe(false);
    expect(writtenFiles.some((f: string) => f.includes('rtl/sample_core_core.vhd'))).toBe(false);

    // Testbench is still generated (basic smoke test, no mm_loader)
    expect(writtenFiles.some((f: string) => f.includes('tb/Makefile'))).toBe(true);
    expect(writtenFiles.some((f: string) => f.includes('tb/mm_loader.py'))).toBe(false);

    // EDA packaging still generated, referencing the single stub file
    expect(writtenFiles.some((f: string) => f.includes('altera/sample_core_hw.tcl'))).toBe(true);
    expect(writtenFiles.some((f: string) => f.includes('xilinx/component.xml'))).toBe(true);

    // The stub has an empty architecture (no submodule instantiations)
    const vhdlContent = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call: string[]) =>
      call[0].includes('rtl/sample_core.vhd')
    )?.[1] as string;
    expect(vhdlContent).toContain('entity sample_core is');
    expect(vhdlContent).not.toContain('u_core');
    expect(vhdlContent).not.toContain('use work.sample_core_pkg.all');
  });

  it('emits secondary clocks/resets across VHDL, SystemVerilog, and Quartus hw.tcl', async () => {
    const inputPath = path.resolve(__dirname, '../../fixtures/multiclock-ipcore.yml');
    const writeMock = fs.writeFile as unknown as jest.Mock;
    const findContent = (needle: string): string =>
      writeMock.mock.calls.find((call) => call[0].includes(needle))?.[1] as string;

    // VHDL + Quartus hw.tcl
    const vhdlResult = await scaffolder.generateAll(inputPath, '/tmp/test-mc-vhdl', {
      includeTestbench: false,
      targets: ['quartus'],
      scaffoldPack: 'builtin-minimal',
    });
    expect(vhdlResult.success).toBe(true);
    const vhdl = findContent('rtl/mc_core.vhd');
    expect(vhdl).toContain('ddr_clk : in std_logic');
    expect(vhdl).toContain('ddr_rst_n : in std_logic');
    const tcl = findContent('altera/mc_core_hw.tcl');
    expect(tcl).toContain('add_interface ddr_clk clock end');
    expect(tcl).toContain('add_interface ddr_rst_n reset end');

    // SystemVerilog
    writeMock.mockClear();
    const svResult = await scaffolder.generateAll(inputPath, '/tmp/test-mc-sv', {
      includeTestbench: false,
      targets: [],
      scaffoldPack: 'builtin-minimal',
      hdlLanguage: 'systemverilog',
    });
    expect(svResult.success).toBe(true);
    const sv = findContent('rtl/mc_core.sv');
    expect(sv).toMatch(/input\s+logic\s+ddr_clk/);
    expect(sv).toMatch(/input\s+logic\s+ddr_rst_n/);
  });

  it('names the primary Quartus clock/reset interfaces after their ports to avoid name collisions', async () => {
    const inputPath = path.resolve(__dirname, '../../fixtures/clockcollision-ipcore.yml');
    const writeMock = fs.writeFile as unknown as jest.Mock;
    const findContent = (needle: string): string =>
      writeMock.mock.calls.find((call) => call[0].includes(needle))?.[1] as string;

    const result = await scaffolder.generateAll(inputPath, '/tmp/test-col', {
      includeTestbench: false,
      targets: ['quartus'],
      scaffoldPack: 'builtin-minimal',
    });
    expect(result.success).toBe(true);
    const tcl = findContent('altera/col_core_hw.tcl');

    // Primary clock/reset interfaces are named after their ports, so a secondary
    // clock/reset literally named "clk"/"reset" does not collide with them.
    expect(tcl).toContain('add_interface s_axi_aclk clock end');
    expect(tcl).toContain('add_interface clk clock end');
    expect(tcl).toContain('add_interface s_axi_aresetn reset end');
    expect(tcl).toContain('add_interface reset reset end');
    // Exactly one clock interface declaration per clock (no duplicate "clk").
    expect((tcl.match(/^add_interface clk clock end$/gm) ?? []).length).toBe(1);
    expect(tcl).toContain('associatedClock s_axi_aclk');
  });

  it('emits interrupt ports on the top-level entity and module (VHDL + SV)', async () => {
    const inputPath = path.resolve(__dirname, '../../fixtures/interrupt-ipcore.yml');
    const writeMock = fs.writeFile as unknown as jest.Mock;
    const findContent = (needle: string): string =>
      writeMock.mock.calls.find((call) => call[0].includes(needle))?.[1] as string;

    const vhdlResult = await scaffolder.generateAll(inputPath, '/tmp/test-irq-vhdl', {
      includeTestbench: false,
      targets: [],
      scaffoldPack: 'builtin-minimal',
    });
    expect(vhdlResult.success).toBe(true);
    const vhdl = findContent('rtl/irq_core.vhd');
    expect(vhdl).toContain('-- Interrupts');
    expect(vhdl).toContain('irq : out std_logic');

    writeMock.mockClear();
    const svResult = await scaffolder.generateAll(inputPath, '/tmp/test-irq-sv', {
      includeTestbench: false,
      targets: [],
      scaffoldPack: 'builtin-minimal',
      hdlLanguage: 'systemverilog',
    });
    expect(svResult.success).toBe(true);
    const sv = findContent('rtl/irq_core.sv');
    expect(sv).toContain('// Interrupts');
    expect(sv).toMatch(/output\s+logic\s+irq/);
  });

  it('expands a clog2 port width across VHDL, SystemVerilog, Tcl, and IP-XACT', async () => {
    const inputPath = path.resolve(__dirname, '../../fixtures/clog2-ipcore.yml');
    const writeMock = fs.writeFile as unknown as jest.Mock;
    const findContent = (needle: string): string =>
      writeMock.mock.calls.find((call) => call[0].includes(needle))?.[1] as string;

    // VHDL run — also emits the vendor Tcl and IP-XACT packaging.
    const vhdlResult = await scaffolder.generateAll(inputPath, '/tmp/test-clog2-vhdl', {
      includeRegs: false,
      includeTestbench: false,
      targets: ['vivado', 'quartus'],
      scaffoldPack: 'builtin-ipcraft',
    });
    expect(vhdlResult.success).toBe(true);

    // VHDL: math_real expansion in the entity port, plus the conditional context clause.
    const vhdl = findContent('rtl/clog2_fifo.vhd');
    expect(vhdl).toContain('use ieee.math_real.all;');
    expect(vhdl).toContain('(integer(ceil(log2(real(FIFO_DEPTH)))))-1 downto 0');

    // Altera Tcl elaborate proc: natural-log clog2 expansion with get_parameter_value.
    const tcl = findContent('altera/clog2_fifo_hw.tcl');
    expect(tcl).toContain('int(ceil(log([get_parameter_value FIFO_DEPTH])/log(2)))');

    // Vivado IP-XACT: XPATH ceiling(log(2, ...)) dependency.
    const xml = findContent('xilinx/component.xml');
    expect(xml).toContain(
      'ceiling(log(2, spirit:decode(id(&apos;MODELPARAM_VALUE.FIFO_DEPTH&apos;))))'
    );

    // SystemVerilog run — $clog2 built-in.
    writeMock.mockClear();
    const svResult = await scaffolder.generateAll(inputPath, '/tmp/test-clog2-sv', {
      includeRegs: false,
      includeTestbench: false,
      targets: [],
      scaffoldPack: 'builtin-ipcraft',
      hdlLanguage: 'systemverilog',
    });
    expect(svResult.success).toBe(true);
    const sv = findContent('rtl/clog2_fifo.sv');
    expect(sv).toContain('($clog2(FIFO_DEPTH))-1:0');
  });

  it('honors the testbench engine option in the scaffolded Makefile', async () => {
    // Scaffold bundles the testbench; the simulator (engine) chosen in settings
    // must reach the generated Makefile, not silently fall back to the default.
    const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
    const outputDir = '/tmp/test-engine-output';

    const result = await scaffolder.generateAll(inputPath, outputDir, {
      includeRegs: true,
      includeTestbench: true,
      framework: 'cocotb',
      engine: 'questa',
      targets: [],
    });

    expect(result.success).toBe(true);

    const makefile = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call: string[]) =>
      call[0].includes('tb/Makefile')
    )?.[1] as string;
    expect(makefile).toContain('SIM ?= questa');
    expect(makefile).not.toContain('SIM ?= ghdl');
  });

  it('uses the active scaffold pack to override built-in CocoTB and vendor templates', async () => {
    // Issue #3: a custom scaffold pack's cocotb_test.py.j2 must shadow the built-in
    // template, the same way pack templates already shadow built-in RTL templates.
    // Vendor toolchain templates (e.g. _hw.tcl) must be equally overridable.
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-scaffolder-pack-'));
    const workspaceRoot = path.join(tmp, 'workspace');
    const packDir = path.join(workspaceRoot, '.vscode', 'ipcraft', 'packs', 'my-pack');
    fs2.mkdirSync(packDir, { recursive: true });
    fs2.writeFileSync(
      path.join(packDir, 'scaffold.yml'),
      'name: "my-pack"\nfullGeneration: true\nfiles: []\n'
    );
    fs2.writeFileSync(path.join(packDir, 'cocotb_test.py.j2'), '# CUSTOM OVERRIDE\n');
    fs2.writeFileSync(path.join(packDir, 'altera_hw_tcl.j2'), '# CUSTOM HW TCL OVERRIDE\n');

    const originalWorkspaceFolders = (vscode.workspace as any).workspaceFolders;
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: workspaceRoot } }];

    try {
      const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
      const outputDir = '/tmp/test-pack-override-output';

      const result = await scaffolder.generateAll(inputPath, outputDir, {
        includeRegs: true,
        includeTestbench: true,
        framework: 'cocotb',
        engine: 'ghdl',
        targets: ['quartus'],
        scaffoldPack: 'my-pack',
      });

      expect(result.success).toBe(true);

      const testFile = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call: string[]) =>
        call[0].includes('_test.py')
      )?.[1] as string;
      expect(testFile).toContain('CUSTOM OVERRIDE');

      const hwTcl = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call: string[]) =>
        call[0].includes('_hw.tcl')
      )?.[1] as string;
      expect(hwTcl).toContain('CUSTOM HW TCL OVERRIDE');
    } finally {
      (vscode.workspace as any).workspaceFolders = originalWorkspaceFolders;
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('lets a scaffold pack override Vivado component.xml generation (issue #4)', async () => {
    // component.xml is built programmatically (VivadoComponentXmlGenerator), not from a
    // .j2 template, so it can't be shadowed by the usual same-named-template convention.
    // A pack-supplied component.xml.j2 should fully replace the generated file instead.
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-scaffolder-pack-'));
    const workspaceRoot = path.join(tmp, 'workspace');
    const packDir = path.join(workspaceRoot, '.vscode', 'ipcraft', 'packs', 'my-vivado-pack');
    fs2.mkdirSync(packDir, { recursive: true });
    fs2.writeFileSync(
      path.join(packDir, 'scaffold.yml'),
      'name: "my-vivado-pack"\nfullGeneration: true\nfiles: []\n'
    );
    fs2.writeFileSync(
      path.join(packDir, 'component.xml.j2'),
      '<?xml version="1.0"?>\n<!-- CUSTOM COMPONENT XML OVERRIDE for {{ name }} -->\n'
    );

    const originalWorkspaceFolders = (vscode.workspace as any).workspaceFolders;
    (vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: workspaceRoot } }];

    try {
      const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
      const outputDir = '/tmp/test-pack-override-vivado-output';

      const result = await scaffolder.generateAll(inputPath, outputDir, {
        includeRegs: true,
        includeTestbench: false,
        targets: ['vivado'],
        scaffoldPack: 'my-vivado-pack',
      });

      expect(result.success).toBe(true);

      const componentXml = (fs.writeFile as unknown as jest.Mock).mock.calls.find(
        (call: string[]) => call[0].includes('xilinx/component.xml')
      )?.[1] as string;
      expect(componentXml).toContain('CUSTOM COMPONENT XML OVERRIDE');
      expect(componentXml).not.toContain('spirit:busInterfaces');
    } finally {
      (vscode.workspace as any).workspaceFolders = originalWorkspaceFolders;
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not add simulation sources to Vivado/Quartus project TCLs', async () => {
    // When includeVhdl: false, collectRtlFiles falls back to reading fileSets.
    // Simulation files (in tb/) must be excluded even when their type is vhdl/sv.
    const inputPath = path.resolve(__dirname, '../../fixtures/import-ipcore.yml');
    const outputDir = '/tmp/test-import-output';

    const result = await scaffolder.generateAll(inputPath, outputDir, {
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
      includeVivadoProject: true,
      includeQuartusProject: true,
      targets: ['vivado', 'quartus'],
    });

    expect(result.success).toBe(true);

    const writtenFiles = (fs.writeFile as unknown as jest.Mock).mock.calls;

    const vivadoProjectCall = writtenFiles.find((call) =>
      String(call[0]).includes('xilinx/import_core_project.tcl')
    );
    expect(vivadoProjectCall).toBeDefined();
    const vivadoContent: string = vivadoProjectCall![1];
    expect(vivadoContent).not.toContain('tb/');
    expect(vivadoContent).not.toContain('import_core_tb');
    // verification/ path is in Simulation_Resources but not under a sim prefix — must be excluded by fileset name
    expect(vivadoContent).not.toContain('verification/');
    expect(vivadoContent).toContain('rtl/import_core_pkg.vhd');
    expect(vivadoContent).toContain('rtl/import_core.vhd');
    // SV file from the same RTL_Sources fileset must also be included
    expect(vivadoContent).toContain('rtl/import_core.sv');

    const quartusProjectCall = writtenFiles.find((call) =>
      String(call[0]).includes('altera/import_core_project.tcl')
    );
    expect(quartusProjectCall).toBeDefined();
    const quartusContent: string = quartusProjectCall![1];
    expect(quartusContent).not.toContain('tb/');
    expect(quartusContent).not.toContain('import_core_tb');
    // verification/ path is in Simulation_Resources but not under a sim prefix — must be excluded by fileset name
    expect(quartusContent).not.toContain('verification/');
    expect(quartusContent).toContain('rtl/import_core_pkg.vhd');
    expect(quartusContent).toContain('rtl/import_core.vhd');
    // SV file from the same RTL_Sources fileset must also be included
    expect(quartusContent).toContain('rtl/import_core.sv');

    // hw.tcl file-set section must also read from ip.yml RTL_Sources (not hardcode entity_name pattern)
    const hwTclCall = writtenFiles.find((call) =>
      String(call[0]).includes('altera/import_core_hw.tcl')
    );
    expect(hwTclCall).toBeDefined();
    const hwTclContent: string = hwTclCall![1];
    // Simulation sources must not appear in the hw.tcl fileset
    expect(hwTclContent).not.toContain('tb/');
    expect(hwTclContent).not.toContain('import_core_tb');
    expect(hwTclContent).not.toContain('verification/');
    // All three RTL_Sources files must appear in the hw.tcl fileset
    const hwLines = hwTclContent.split('\n');
    const pkgLine = hwLines.find((l) =>
      l.includes('add_fileset_file import_core_pkg.vhd VHDL PATH')
    );
    const vhdLine = hwLines.find((l) => l.includes('add_fileset_file import_core.vhd VHDL PATH'));
    const svLine = hwLines.find((l) =>
      l.includes('add_fileset_file import_core.sv SYSTEM_VERILOG PATH')
    );
    expect(pkgLine).toBeDefined();
    expect(vhdLine).toBeDefined();
    expect(svLine).toBeDefined();
    // Only import_core.vhd (the VHDL entity file) should be marked as TOP_LEVEL_FILE
    expect(pkgLine).not.toContain('TOP_LEVEL_FILE');
    expect(vhdLine).toContain('TOP_LEVEL_FILE');
    expect(svLine).not.toContain('TOP_LEVEL_FILE');
  });

  it('includes hand-authored fileSets RTL files in component.xml on re-scaffold (issue #43)', async () => {
    // Repro: (1) scaffold, (2) user implements their own logic in a separate file and
    // declares it in .ip.yml's fileSets (managed: false so it is never overwritten),
    // (3) scaffold again. The custom file must still be referenced in component.xml —
    // previously collectRtlFiles() returned early as soon as the scaffold pack itself
    // had generated any rtl/ file, silently dropping every fileSets-only entry.
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-scaffolder-userfile-'));
    try {
      fs2.mkdirSync(path.join(tmp, 'rtl'), { recursive: true });
      fs2.writeFileSync(
        path.join(tmp, 'rtl', 'my_custom_logic.vhd'),
        [
          'entity my_custom_logic is',
          'end entity my_custom_logic;',
          'architecture rtl of my_custom_logic is',
          'begin',
          'end architecture rtl;',
        ].join('\n')
      );

      const inputPath = path.join(tmp, 'user_core.ip.yml');
      fs2.writeFileSync(
        inputPath,
        [
          'vlnv:',
          '  vendor: test',
          '  library: lib',
          '  name: user_core',
          '  version: 1.0.0',
          'clocks:',
          '  - name: clk',
          '    direction: in',
          'busInterfaces: []',
          'fileSets:',
          '  - name: RTL_Sources',
          '    files:',
          '      - path: rtl/my_custom_logic.vhd',
          '        type: vhdl',
          '        managed: false',
        ].join('\n')
      );

      const outputDir = '/tmp/test-output-userfile';
      const result = await scaffolder.generateAll(inputPath, outputDir, {
        includeRegs: false,
        includeTestbench: false,
        targets: ['vivado'],
      });

      expect(result.success).toBe(true);

      const componentXml = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
        String(call[0]).includes('xilinx/component.xml')
      )?.[1] as string;
      expect(componentXml).toBeDefined();
      expect(componentXml).toContain('rtl/my_custom_logic.vhd');
      // The scaffold-pack-generated entity file must still be present alongside it.
      expect(componentXml).toContain('rtl/user_core.vhd');
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('includes hand-authored fileSets RTL files in the testbench Makefile alongside generated ones', async () => {
    // Same class of bug as issue #43, but in the cocotb Makefile: cocotb_makefile.j2's
    // {% if rtl_source_files %} / {% else %} was all-or-nothing, so declaring even one
    // custom file in fileSets (without also re-listing every generated file) used to make
    // the Makefile drop the scaffold-pack-generated sources from the simulation build.
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-scaffolder-tb-userfile-'));
    try {
      fs2.mkdirSync(path.join(tmp, 'rtl'), { recursive: true });
      fs2.writeFileSync(
        path.join(tmp, 'rtl', 'my_custom_logic.vhd'),
        [
          'entity my_custom_logic is',
          'end entity my_custom_logic;',
          'architecture rtl of my_custom_logic is',
          'begin',
          'end architecture rtl;',
        ].join('\n')
      );

      const inputPath = path.join(tmp, 'tb_user_core.ip.yml');
      fs2.writeFileSync(
        inputPath,
        [
          'vlnv:',
          '  vendor: test',
          '  library: lib',
          '  name: tb_user_core',
          '  version: 1.0.0',
          'clocks:',
          '  - name: clk',
          '    direction: in',
          'busInterfaces: []',
          'fileSets:',
          '  - name: RTL_Sources',
          '    files:',
          '      - path: rtl/my_custom_logic.vhd',
          '        type: vhdl',
          '        managed: false',
        ].join('\n')
      );

      // Scaffold into the same directory the .ip.yml and rtl/ live in (the common layout),
      // so the fileSets-declared custom file's path is a simple sibling of the generated one.
      const outputDir = tmp;
      const result = await scaffolder.generateAll(inputPath, outputDir, {
        includeRegs: false,
        includeTestbench: true,
        targets: [],
      });

      expect(result.success).toBe(true);

      const makefile = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
        String(call[0]).includes('tb/Makefile')
      )?.[1] as string;
      expect(makefile).toBeDefined();
      expect(makefile).toContain('VHDL_SOURCES += $(BASE_DIR)/rtl/my_custom_logic.vhd');
      expect(makefile).toContain('VHDL_SOURCES += $(BASE_DIR)/rtl/tb_user_core.vhd');
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('handles generation failure gracefully', async () => {
    // Force an error by passing a non-existent input path
    const result = await scaffolder.generateAll('/non/existent.yml', '/out');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(logger.error).toHaveBeenCalled();
  });

  it('emits syntactically valid VHDL for an Avalon-MM slave with no useOptionalPorts (regression)', async () => {
    // Every port in avalon_mm.yml is presence:optional (no mandatory ports), so
    // omitting useOptionalPorts entirely yields an empty bus_ports list for the
    // template context. bus_avmm.vhdl.j2 used `{% if bus_ports %}` to guard the
    // port-list block; Nunjucks treats an empty array as truthy (JS semantics,
    // unlike Jinja2/Python), so the guard fired anyway, the for-loop rendered
    // nothing, and the block's static trailing `;` was emitted with no port
    // declarations before it -- invalid VHDL (a bare `;` inside the entity's
    // port list).
    const inputPath = path.resolve(__dirname, '../../fixtures/avmm-no-optional-ports.ip.yml');
    const outputDir = '/tmp/test-output-avmm-no-optional-ports';

    const result = await scaffolder.generateAll(inputPath, outputDir, {
      includeRegs: true,
      includeTestbench: false,
      targets: [],
      hdlLanguage: 'vhdl',
      scaffoldPack: 'builtin-ipcraft',
    });

    expect(result.success).toBe(true);

    const vhdlContent = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
      call[0].includes('_avmm.vhd')
    )?.[1];
    expect(vhdlContent).toBeDefined();
    // No line may consist solely of a semicolon -- the exact shape of the bug.
    expect(vhdlContent).not.toMatch(/^\s*;\s*$/m);
    // With zero bus ports the whole guarded block (including its header
    // comment) must be suppressed, not just the for-loop body.
    expect(vhdlContent).not.toContain('-- Avalon-MM Slave Interface');
  });

  it('generates a cocotb mm_loader.py that reads camelCase addressBlocks/baseAddress (regression)', async () => {
    // mm_loader.py.j2 (the generated cocotb helper for iterating a .mm.yml's
    // registers) used to look up snake_case `address_blocks`/`base_address`,
    // but the memory-map schema only ever defines camelCase `addressBlocks`/
    // `baseAddress` (this repo's own convention: "Strict camelCase, no
    // dual-state fallbacks"). Every `for block in mm.get("address_blocks",
    // [])` therefore silently found nothing, so `load_regmap()` always
    // returned an empty register list -- invisible because generated cocotb
    // tests only log read-back values, never assert on them.
    //
    // A second, compounding bug in the same file: `_parse_bits` split a
    // `bits` string on ":" without first stripping the schema's literal
    // `[`/`]` brackets (the documented format is e.g. "[7:0]"), so
    // `int("[7")` raised ValueError for every real bit field the moment the
    // addressBlocks fix above let execution reach it.
    const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
    const outputDir = '/tmp/test-output-mm-loader';

    const result = await scaffolder.generateAll(inputPath, outputDir, {
      includeRegs: true,
      includeTestbench: true,
      targets: [],
      scaffoldPack: 'builtin-ipcraft',
    });

    expect(result.success).toBe(true);

    const mmLoaderContent = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
      call[0].includes('mm_loader.py')
    )?.[1];
    expect(mmLoaderContent).toBeDefined();
    expect(mmLoaderContent).toContain('"addressBlocks"');
    expect(mmLoaderContent).toContain('"baseAddress"');
    expect(mmLoaderContent).not.toContain('address_blocks');
    expect(mmLoaderContent).not.toContain('base_address');
    expect(mmLoaderContent).toContain('s.startswith("[") and s.endswith("]")');
  });

  it('generates a Quartus .sdc with create_clock on its own line (regression)', async () => {
    // quartus_sdc.j2's clock-comment line used an inline
    // `{% if clock.frequency %} — {{ clock.frequency }}{% endif %}` whose
    // trailing `{% endif %}` had its newline consumed by trimBlocks: true
    // (this repo's own documented gotcha, see CLAUDE.md) -- the following
    // `create_clock ...` line was merged onto the same (comment) line and
    // silently swallowed as part of the Tcl comment, so the constraint was
    // never actually applied. Confirmed on a real Quartus 25.1std run: the
    // affected project reported "Design is not fully constrained for setup
    // requirements" and negative timing slack.
    const tmpPath = require('path').join(
      require('os').tmpdir(),
      `ipcraft_sdc_test_${Date.now()}.ip.yml`
    );
    const yaml = [
      'vlnv:',
      '  vendor: test',
      '  library: lib',
      '  name: sdc_core',
      '  version: 1.0.0',
      'clocks:',
      '  - name: clk',
      '    direction: in',
      '    frequency: 50MHz',
    ].join('\n');

    const realFs = jest.requireActual('fs/promises') as typeof import('fs/promises');
    await realFs.writeFile(tmpPath, yaml, 'utf-8');

    try {
      const result = await scaffolder.generateAll(tmpPath, '/tmp/test-output-sdc', {
        targets: ['quartus'],
        includeQuartusProject: true,
        quartusDevice: '5CSEBA6U23I7',
      });
      expect(result.success).toBe(true);

      const sdcContent = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
        call[0].endsWith('.sdc')
      )?.[1];
      expect(sdcContent).toBeDefined();
      expect(sdcContent).toMatch(/^create_clock -period 20\.000 -name clk/m);
      expect(sdcContent).not.toContain('50MHzcreate_clock');

      // Second, related bug: quartus_project.tcl.j2 wrapped SDC_FILE in the
      // same `[file join .. ...]` used for rtl_files, but the .sdc is
      // written as a sibling of project.tcl in altera/ (rtl files live one
      // level up in ../rtl/) -- the extra ".." made Quartus report
      // "Synopsys Design Constraints File file not found", confirmed on a
      // real Quartus 25.1std run.
      const projectTclContent = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
        call[0].endsWith('_project.tcl')
      )?.[1];
      expect(projectTclContent).toBeDefined();
      expect(projectTclContent).toContain('set_global_assignment -name SDC_FILE sdc_core.sdc');
      expect(projectTclContent).not.toContain('SDC_FILE [file join');
    } finally {
      await realFs.unlink(tmpPath).catch(() => {});
    }
  });

  it('surfaces ajv schema error when simulation.engine is invalid', async () => {
    // Write a temp fixture with an invalid simulation.engine value
    const tmpPath = require('path').join(
      require('os').tmpdir(),
      `ipcraft_schema_test_${Date.now()}.ip.yml`
    );
    const badYaml = [
      'vlnv:',
      '  vendor: test',
      '  library: lib',
      '  name: bad_core',
      '  version: 1.0.0',
      'simulation:',
      '  engine: typo',
    ].join('\n');

    const realFs = jest.requireActual('fs/promises') as typeof import('fs/promises');
    await realFs.writeFile(tmpPath, badYaml, 'utf-8');

    try {
      const result = await scaffolder.generateAll(tmpPath, '/tmp/bad-out');
      expect(result.success).toBe(false);
      expect(result.error).toContain('simulation.engine');
    } finally {
      await realFs.unlink(tmpPath).catch(() => {});
    }
  });

  it('accepts hand-written HDL parameter types and emits them as natural (issue #24)', async () => {
    // A user-authored `dataType: positive` must not fail schema validation; it is
    // canonicalised to `natural` and surfaces as a `natural` VHDL generic.
    const tmpPath = path.join(os.tmpdir(), `ipcraft_positive_${Date.now()}.ip.yml`);
    const yaml = [
      'vlnv:',
      '  vendor: test',
      '  library: lib',
      '  name: positive_core',
      '  version: 1.0.0',
      'parameters:',
      '  - name: PDA_DATA_WIDTH',
      '    dataType: positive',
      '    value: 64',
      'clocks:',
      '  - name: Clk',
      '    direction: in',
      'busInterfaces: []',
    ].join('\n');

    const realFs = jest.requireActual('fs/promises') as typeof import('fs/promises');
    await realFs.writeFile(tmpPath, yaml, 'utf-8');

    try {
      const result = await scaffolder.generateAll(tmpPath, '/tmp/positive-out', {
        includeRegs: false,
        includeTestbench: false,
        targets: [],
      });

      expect(result.success).toBe(true);

      const vhdlContent = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
        String(call[0]).includes('rtl/positive_core.vhd')
      )?.[1] as string;
      expect(vhdlContent).toContain('PDA_DATA_WIDTH : natural := 64');
    } finally {
      await realFs.unlink(tmpPath).catch(() => {});
    }
  });

  it('generates _hw.tcl with parameterized conduit interfaces correctly', async () => {
    // BusLibraryService mock returns xcvr bus definition with string-width ports
    (BusLibraryService as jest.Mock).mockImplementation(() => ({
      loadDefaultLibrary: jest.fn().mockResolvedValue({}),
      loadFromDirectories: jest.fn().mockResolvedValue({
        Xcvr: {
          busType: { vendor: 'user', library: 'busif', name: 'xcvr', version: '1.0' },
          ports: [
            { name: 'tx_data', presence: 'required', direction: 'out', width: 'XCVR_DW' },
            { name: 'tx_k', presence: 'required', direction: 'out', width: 'XCVR_KW' },
          ],
        },
      }),
      clearCache: jest.fn(),
    }));
    scaffolder = new IpCoreScaffolder(logger, loader, resourceRoots);

    const inputPath = path.resolve(__dirname, '../../fixtures/xcvr-ipcore.yml');

    const result = await scaffolder.generateAll(inputPath, '/tmp/xcvr-gen', {
      targets: ['quartus'],
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
    });

    expect(result.success).toBe(true);

    const tclContent = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
      String(call[0]).includes('xcvr_core_hw.tcl')
    )?.[1] as string | undefined;

    expect(tclContent).toBeDefined();

    // ELABORATION_CALLBACK must be registered at module level when parameterized ports exist
    expect(tclContent).toContain('set_module_property ELABORATION_CALLBACK elaborate');

    // Parameterized ports must NOT appear at global scope (only non-parameterized ports do)
    expect(tclContent).not.toMatch(/^add_interface_port xcvr_if_in xcvr_if_in_tx_data/m);
    expect(tclContent).not.toMatch(/^add_interface_port xcvr_if_out xcvr_if_out_tx_data/m);
    expect(tclContent).not.toMatch(/^add_interface_port o_data/m);

    // Bug 2 fix: conduit interfaces always use 'end', never 'start'
    expect(tclContent).toContain('add_interface xcvr_if_in conduit end');
    expect(tclContent).toContain('add_interface xcvr_if_out conduit end');
    expect(tclContent).not.toContain('conduit start');

    // elaborate proc uses add_interface_port (not deprecated set_port_property WIDTH)
    expect(tclContent).toContain('proc elaborate {');
    expect(tclContent).not.toContain('set_port_property');
    expect(tclContent).toContain(
      'add_interface_port xcvr_if_in xcvr_if_in_tx_data tx_data Input [get_parameter_value XCVR_DW]'
    );
    expect(tclContent).toContain(
      'add_interface_port xcvr_if_out xcvr_if_out_tx_data tx_data Output [get_parameter_value XCVR_DW]'
    );
    expect(tclContent).toContain(
      'add_interface_port xcvr_if_out xcvr_if_out_tx_k tx_k Output [get_parameter_value XCVR_KW]'
    );
    expect(tclContent).toContain(
      'add_interface_port o_data o_data o_data Output [get_parameter_value DATA_WIDTH]'
    );
  });

  it('places arithmetic expression user ports in the elaborate proc (Rb_ByteEna pattern)', async () => {
    // No custom bus library needed — this IP has no bus interfaces.
    (BusLibraryService as jest.Mock).mockImplementation(() => ({
      loadDefaultLibrary: jest.fn().mockResolvedValue({}),
      loadFromDirectories: jest.fn().mockResolvedValue({}),
      clearCache: jest.fn(),
    }));
    scaffolder = new IpCoreScaffolder(logger, loader, resourceRoots);

    const inputPath = path.resolve(__dirname, '../../fixtures/expr-ipcore.yml');

    const result = await scaffolder.generateAll(inputPath, '/tmp/expr-gen', {
      targets: ['quartus'],
      includeVhdl: false,
      includeRegs: false,
      includeTestbench: false,
    });

    expect(result.success).toBe(true);

    const tclContent = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
      String(call[0]).includes('expr_core_hw.tcl')
    )?.[1] as string | undefined;

    expect(tclContent).toBeDefined();

    // ELABORATION_CALLBACK required because Rb_ByteEna width is parameterized
    expect(tclContent).toContain('set_module_property ELABORATION_CALLBACK elaborate');

    // Parameterized user port must NOT appear at global scope
    expect(tclContent).not.toMatch(/^add_interface_port Rb_ByteEna/m);

    // elaborate proc must contain add_interface_port with the TCL expression for width = N/8
    expect(tclContent).toContain('proc elaborate {');
    expect(tclContent).toContain(
      'add_interface_port Rb_ByteEna Rb_ByteEna rb_byteena Output [expr [get_parameter_value AXIDATAWIDTH_G]/8]'
    );

    // Simple param reference: Rb_WrData width = AxiDataWidth_g → [get_parameter_value AXIDATAWIDTH_G]
    expect(tclContent).toContain(
      'add_interface_port Rb_WrData Rb_WrData rb_wrdata Output [get_parameter_value AXIDATAWIDTH_G]'
    );
  });

  it('merges in the cached Vivado interface catalog when it has been scanned', async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, defaultValue?: unknown) => defaultValue,
    });
    const loadFromUserPaths = jest.fn().mockResolvedValue({});
    (BusLibraryService as jest.Mock).mockImplementation(() => ({
      loadDefaultLibrary: jest.fn().mockResolvedValue({}),
      loadFromUserPaths,
      clearCache: jest.fn(),
    }));
    mockVivadoPathExists.mockResolvedValue(true);
    scaffolder = new IpCoreScaffolder(logger, loader, resourceRoots);

    const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
    await scaffolder.generateAll(inputPath, '/tmp/test-output', {
      includeRegs: false,
      includeTestbench: false,
      targets: ['vivado'],
    });

    expect(loadFromUserPaths).toHaveBeenCalledWith(
      expect.arrayContaining(['/fake/vivado/cache/bus_definitions']),
      undefined
    );
  });

  it('does not include the Vivado interface cache when it has not been scanned', async () => {
    (vscode.workspace.getConfiguration as jest.Mock).mockReturnValue({
      get: (_key: string, defaultValue?: unknown) => defaultValue,
    });
    const loadFromUserPaths = jest.fn().mockResolvedValue({});
    (BusLibraryService as jest.Mock).mockImplementation(() => ({
      loadDefaultLibrary: jest.fn().mockResolvedValue({}),
      loadFromUserPaths,
      clearCache: jest.fn(),
    }));
    mockVivadoPathExists.mockResolvedValue(false);
    scaffolder = new IpCoreScaffolder(logger, loader, resourceRoots);

    const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
    await scaffolder.generateAll(inputPath, '/tmp/test-output', {
      includeRegs: false,
      includeTestbench: false,
      targets: ['vivado'],
    });

    expect(loadFromUserPaths).not.toHaveBeenCalled();
  });

  it('merges workspace bus definitions into component.xml port maps (issue #51)', async () => {
    // When WorkspaceBusDefinitionScanner returns a bus definition, ensureBusDefinitions
    // must include it in busDefinitions so renderBusInterface can emit spirit:portMaps.
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-workspace-busdef-'));
    try {
      const inputPath = path.join(tmp, 'ws_core.ip.yml');
      fs2.writeFileSync(
        inputPath,
        [
          'vlnv:',
          '  vendor: test',
          '  library: lib',
          '  name: ws_core',
          '  version: 1.0.0',
          'clocks:',
          '  - name: clk',
          '    direction: in',
          'busInterfaces:',
          '  - name: stream_in',
          '    type: "acme.com:interface:my_proto:1.0"',
          '    mode: slave',
          '    physicalPrefix: "s_"',
          '    useOptionalPorts: []',
          '    portWidthOverrides: {}',
        ].join('\n')
      );

      const workspaceBusDef = {
        MY_PROTO: {
          busType: { vendor: 'acme.com', library: 'interface', name: 'my_proto', version: '1.0' },
          source: 'workspace' as const,
          ports: [
            { name: 'DATA', width: 32, direction: 'out' as const, presence: 'required' as const },
          ],
        },
      };
      mockWorkspaceScan.mockResolvedValue({ library: workspaceBusDef, files: [], count: 1 });

      (BusLibraryService as jest.Mock).mockImplementation(() => ({
        loadDefaultLibrary: jest.fn().mockResolvedValue({}),
        loadFromUserPaths: jest.fn().mockResolvedValue({}),
        clearCache: jest.fn(),
      }));
      scaffolder = new IpCoreScaffolder(logger, loader, resourceRoots);

      const result = await scaffolder.generateAll(inputPath, '/tmp/ws-bus-out', {
        includeRegs: false,
        includeTestbench: false,
        targets: ['vivado'],
      });

      expect(result.success).toBe(true);

      const componentXml = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
        String(call[0]).includes('xilinx/component.xml')
      )?.[1] as string;
      expect(componentXml).toBeDefined();
      // The bus interface must appear with port maps from the workspace bus definition
      expect(componentXml).toContain('<spirit:name>DATA</spirit:name>');
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
