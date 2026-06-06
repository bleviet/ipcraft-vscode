/* eslint-disable */
import * as path from 'path';
import * as fs from 'fs/promises';
import { IpCoreScaffolder } from '../../../generator/IpCoreScaffolder';
import { TemplateLoader } from '../../../generator/TemplateLoader';
import { Logger } from '../../../utils/Logger';
import { BusLibraryService } from '../../../services/BusLibraryService';

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

describe('IpCoreScaffolder', () => {
  let scaffolder: any;
  const logger = new Logger('test');
  const templatesPath = path.resolve(__dirname, '../../../generator/templates');
  const loader = new TemplateLoader(logger, templatesPath);

  const context = { extensionPath: '/ext' } as any;

  beforeEach(() => {
    // resetMocks: true in jest.config resets all mock implementations before each test.
    // Re-apply the BusLibraryService mock implementation before constructing the scaffolder.
    (BusLibraryService as jest.Mock).mockImplementation(() => ({
      loadDefaultLibrary: jest.fn().mockResolvedValue({
        AXI4L: { ports: [{ name: 'AWADDR', presence: 'required' }] },
      }),
      clearCache: jest.fn(),
    }));
    scaffolder = new IpCoreScaffolder(logger, loader, context);
    jest.clearAllMocks();
  });

  it('generates a full project structure (bahonaviMethodology)', async () => {
    const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
    const outputDir = '/tmp/test-output';

    const result = await scaffolder.generateAll(inputPath, outputDir, {
      includeRegs: true,
      includeTestbench: true,
      targets: ['vivado', 'quartus'],
      bahonaviMethodology: true,
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

    // Verify Vivado component.xml contains parameter description
    const xmlContent = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
      call[0].includes('xilinx/component.xml')
    )?.[1];
    expect(xmlContent).toContain('<spirit:description>Width of the data bus</spirit:description>');
  });

  it('generates a single minimal stub by default (no bahonaviMethodology)', async () => {
    const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
    const outputDir = '/tmp/test-minimal-output';

    const result = await scaffolder.generateAll(inputPath, outputDir, {
      includeRegs: true,
      includeTestbench: true,
      targets: ['vivado', 'quartus'],
      // bahonaviMethodology: false is the default
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

  it('handles generation failure gracefully', async () => {
    // Force an error by passing a non-existent input path
    const result = await scaffolder.generateAll('/non/existent.yml', '/out');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(logger.error).toHaveBeenCalled();
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
    scaffolder = new IpCoreScaffolder(logger, loader, context);

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
    scaffolder = new IpCoreScaffolder(logger, loader, context);

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
});
