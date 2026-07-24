import * as path from 'path';
import * as fs from 'fs/promises';
import * as fs2 from 'fs';
import * as os from 'os';
import { runCliGenerate, DEFAULT_QUARTUS_DEVICE } from '../../../cli/generate';
import { BusLibraryService } from '../../../services/BusLibraryService';
import { Logger } from '../../../utils/Logger';
import { devResourceRoots } from '../../../services/ResourceRoots';

// Mock Logger (same convention as IpCoreScaffolder.test.ts) so the CLI logic doesn't spam
// the test output — the CLI itself renders these through console via vscodeShim.
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

const mockVivadoPathExists = jest.fn<Promise<boolean>, [string]>().mockResolvedValue(false);
jest.mock('../../../services/VivadoInterfaceScanner', () => ({
  getVivadoInterfaceCacheDir: () => '/fake/vivado/cache/bus_definitions',
  pathExists: (p: string) => mockVivadoPathExists(p),
}));

const mockWorkspaceScan = jest.fn().mockResolvedValue({ library: {}, files: [], count: 0 });
jest.mock('../../../services/WorkspaceBusDefinitionScanner', () => ({
  getWorkspaceBusDefinitionScanner: () => ({ scan: mockWorkspaceScan }),
}));

jest.mock('fs/promises', () => {
  const actual: typeof import('fs/promises') = jest.requireActual('fs/promises');
  return {
    ...actual,
    mkdir: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
  };
});

const repoRoot = path.resolve(__dirname, '../../../..');
const resourceRoots = devResourceRoots(repoRoot);

describe('runCliGenerate', () => {
  beforeEach(() => {
    (Logger as unknown as jest.Mock).mockImplementation(() => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }));
    (BusLibraryService as jest.Mock).mockImplementation(() => ({
      loadDefaultLibrary: jest.fn().mockResolvedValue({
        AXI4L: { ports: [{ name: 'AWADDR', presence: 'required' }] },
      }),
      clearCache: jest.fn(),
    }));
    mockVivadoPathExists.mockResolvedValue(false);
    mockWorkspaceScan.mockResolvedValue({ library: {}, files: [], count: 0 });
    jest.clearAllMocks();
  });

  it('generates RTL + testbench for a valid .ip.yml (no vendor target)', async () => {
    const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
    const result = await runCliGenerate(
      { ipYamlPath: inputPath, outDir: '/tmp/cli-test-output', targets: [], hdlLanguage: 'vhdl' },
      resourceRoots
    );

    expect(result.success).toBe(true);
    expect(result.outputDir).toBe('/tmp/cli-test-output');
    expect(result.files?.some((f) => f.includes('rtl/sample_core.vhd'))).toBe(true);
    expect(result.files?.some((f) => f.includes('tb/Makefile'))).toBe(true);
    // No vendor project requested -- no altera/xilinx packaging output.
    expect(result.files?.some((f) => f.includes('altera/'))).toBe(false);
  });

  it('defaults the Quartus device when --target quartus is set without an explicit device', async () => {
    const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
    const result = await runCliGenerate(
      {
        ipYamlPath: inputPath,
        outDir: '/tmp/cli-test-quartus',
        targets: ['quartus'],
        hdlLanguage: 'vhdl',
      },
      resourceRoots
    );

    expect(result.success).toBe(true);
    const hwTcl = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
      String(call[0]).includes('_hw.tcl')
    )?.[1] as string | undefined;
    expect(hwTcl).toBeDefined();
    // The quartus_project.tcl is where the device part actually shows up.
    const projectTcl = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
      String(call[0]).includes('_project.tcl')
    )?.[1] as string | undefined;
    expect(projectTcl).toContain(DEFAULT_QUARTUS_DEVICE);
  });

  it('threads --indent-style/--indent-size through to written RTL files (issue #159)', async () => {
    const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
    const result = await runCliGenerate(
      {
        ipYamlPath: inputPath,
        outDir: '/tmp/cli-test-indent',
        targets: [],
        hdlLanguage: 'vhdl',
        indentStyle: 'tab',
        indentSize: 8,
      },
      resourceRoots
    );

    expect(result.success).toBe(true);
    const entityVhd = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
      String(call[0]).includes('rtl/sample_core.vhd')
    )?.[1] as string | undefined;
    expect(entityVhd).toBeDefined();
    expect(entityVhd).not.toMatch(/^ +/m);
  });

  it('applies a pack-declared indentation default when no CLI flags are passed (issue #160)', async () => {
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-cli-pack-indent-'));
    const packDir = path.join(tmp, 'tab-pack');
    fs2.mkdirSync(packDir, { recursive: true });
    fs2.writeFileSync(
      path.join(packDir, 'scaffold.yml'),
      [
        'name: "tab-pack"',
        'files:',
        '  - source: architecture.vhdl.j2',
        '    target: rtl/example.vhd',
        'generation:',
        '  indentation:',
        '    style: tab',
        '',
      ].join('\n')
    );

    try {
      const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
      const result = await runCliGenerate(
        {
          ipYamlPath: inputPath,
          outDir: path.join(tmp, 'output'),
          targets: [],
          hdlLanguage: 'vhdl',
          scaffoldPack: packDir,
        },
        resourceRoots
      );

      expect(result.success).toBe(true);
      const exampleVhd = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
        String(call[0]).includes('rtl/example.vhd')
      )?.[1] as string | undefined;
      expect(exampleVhd).toBeDefined();
      expect(exampleVhd).toContain('\t\t-- Your architecture code goes here');
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('lets an explicit --indent-style flag override the pack default (issue #160)', async () => {
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-cli-pack-indent-override-'));
    const packDir = path.join(tmp, 'tab-pack');
    fs2.mkdirSync(packDir, { recursive: true });
    fs2.writeFileSync(
      path.join(packDir, 'scaffold.yml'),
      [
        'name: "tab-pack"',
        'files:',
        '  - source: architecture.vhdl.j2',
        '    target: rtl/example.vhd',
        'generation:',
        '  indentation:',
        '    style: tab',
        '',
      ].join('\n')
    );

    try {
      const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
      const result = await runCliGenerate(
        {
          ipYamlPath: inputPath,
          outDir: path.join(tmp, 'output'),
          targets: [],
          hdlLanguage: 'vhdl',
          scaffoldPack: packDir,
          indentStyle: 'spaces',
        },
        resourceRoots
      );

      expect(result.success).toBe(true);
      const exampleVhd = (fs.writeFile as unknown as jest.Mock).mock.calls.find((call) =>
        String(call[0]).includes('rtl/example.vhd')
      )?.[1] as string | undefined;
      expect(exampleVhd).toBeDefined();
      expect(exampleVhd).not.toMatch(/^\t/m);
      expect(exampleVhd).toContain('    -- Your architecture code goes here');
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('exits with a readable, non-generic error for a schema-invalid .ip.yml (issue #72 AC2)', async () => {
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-cli-invalid-'));
    try {
      const inputPath = path.join(tmp, 'bad.ip.yml');
      fs2.writeFileSync(
        inputPath,
        [
          'vlnv:',
          '  vendor: test',
          '  library: lib',
          '  name: bad_core',
          '  version: 1.0.0',
          'simulation:',
          '  engine: not_a_real_engine',
        ].join('\n')
      );

      const result = await runCliGenerate(
        { ipYamlPath: inputPath, targets: [], hdlLanguage: 'vhdl' },
        resourceRoots
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('simulation.engine');
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('exits with a non-zero result and an actionable error for a pack requirements mismatch (issue #152)', async () => {
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-cli-requirements-'));
    const packDir = path.join(tmp, 'avalon-only-pack');
    fs2.mkdirSync(packDir, { recursive: true });
    fs2.writeFileSync(
      path.join(packDir, 'scaffold.yml'),
      [
        'name: "avalon-only-pack"',
        'fullGeneration: true',
        'requirements:',
        '  busTypes:',
        '    - avmm',
        'files: []',
      ].join('\n')
    );

    try {
      // sample-ipcore.yml declares an AXI4L slave — incompatible with an Avalon-MM-only pack.
      const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
      const result = await runCliGenerate(
        {
          ipYamlPath: inputPath,
          outDir: path.join(tmp, 'output'),
          targets: [],
          hdlLanguage: 'vhdl',
          scaffoldPack: packDir,
        },
        resourceRoots
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Scaffold pack 'avalon-only-pack' is incompatible");
      expect(result.error).toContain(
        "requires bus type [avmm], but the IP core's primary slave interface is 'axil'"
      );
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('surfaces a warning when a pack renders its own sim-like output without declaring generateFrameworkTestbench (issue #156)', async () => {
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-cli-tbwarn-'));
    const packDir = path.join(tmp, 'own-sim-pack');
    fs2.mkdirSync(packDir, { recursive: true });
    fs2.writeFileSync(
      path.join(packDir, 'scaffold.yml'),
      [
        'name: "own-sim-pack"',
        'fullGeneration: true',
        'files:',
        '  - source: custom_tb.vhd.j2',
        '    target: sim/custom_tb.vhd',
      ].join('\n')
    );
    fs2.writeFileSync(path.join(packDir, 'custom_tb.vhd.j2'), '-- custom testbench\n');

    try {
      const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
      const result = await runCliGenerate(
        {
          ipYamlPath: inputPath,
          outDir: path.join(tmp, 'output'),
          targets: [],
          hdlLanguage: 'vhdl',
          scaffoldPack: packDir,
        },
        resourceRoots
      );

      expect(result.success).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings?.[0]).toContain('generateFrameworkTestbench');
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('defaults the output directory to alongside the .ip.yml when --out is omitted', async () => {
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-cli-outdir-'));
    try {
      const inputPath = path.join(tmp, 'blinker.ip.yml');
      fs2.writeFileSync(
        inputPath,
        [
          'vlnv:',
          '  vendor: test',
          '  library: lib',
          '  name: blinker',
          '  version: 1.0.0',
          'apiVersion: "1.0"',
          'scaffold_pack: builtin-minimal',
          'clocks:',
          '  - name: clk',
          '    direction: in',
          'busInterfaces: []',
        ].join('\n')
      );

      const result = await runCliGenerate(
        { ipYamlPath: inputPath, targets: [], hdlLanguage: 'vhdl' },
        resourceRoots
      );

      expect(result.success).toBe(true);
      expect(result.outputDir).toBe(tmp);
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
