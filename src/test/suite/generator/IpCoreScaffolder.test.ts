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

  it('generates a full project structure', async () => {
    const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
    const outputDir = '/tmp/test-output';

    const result = await scaffolder.generateAll(inputPath, outputDir, {
      includeRegs: true,
      includeTestbench: true,
      vendor: 'both',
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
      vendor: 'both',
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
    expect(vivadoContent).toContain('rtl/import_core_pkg.vhd');
    expect(vivadoContent).toContain('rtl/import_core.vhd');

    const quartusProjectCall = writtenFiles.find((call) =>
      String(call[0]).includes('altera/import_core_project.tcl')
    );
    expect(quartusProjectCall).toBeDefined();
    const quartusContent: string = quartusProjectCall![1];
    expect(quartusContent).not.toContain('tb/');
    expect(quartusContent).not.toContain('import_core_tb');
    expect(quartusContent).toContain('rtl/import_core_pkg.vhd');
    expect(quartusContent).toContain('rtl/import_core.vhd');
  });

  it('handles generation failure gracefully', async () => {
    // Force an error by passing a non-existent input path
    const result = await scaffolder.generateAll('/non/existent.yml', '/out');

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
