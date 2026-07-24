import * as path from 'path';
import * as fs2 from 'fs';
import * as os from 'os';
import { runCliGenerate } from '../../../cli/generate';
import { runCliVerify } from '../../../cli/verify';
import { BusLibraryService } from '../../../services/BusLibraryService';
import { Logger } from '../../../utils/Logger';
import { devResourceRoots } from '../../../services/ResourceRoots';

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

// This suite writes real files to a real temp dir (unlike IpCoreScaffolder.test.ts, which
// mocks fs/promises) -- staleness detection is meaningless without a real committed output
// directory to diff against, so fs/promises is intentionally left unmocked here.

const repoRoot = path.resolve(__dirname, '../../../..');
const resourceRoots = devResourceRoots(repoRoot);

function writeBlinkerIpYaml(dir: string, frequency: string): string {
  const inputPath = path.join(dir, 'led_blink.ip.yml');
  fs2.writeFileSync(
    inputPath,
    [
      'vlnv:',
      '  vendor: test',
      '  library: lib',
      '  name: led_blink',
      '  version: 1.0.0',
      'apiVersion: "1.0"',
      'scaffold_pack: builtin-minimal',
      'clocks:',
      `  - name: clk`,
      '    direction: in',
      `    frequency: ${frequency}`,
      'busInterfaces: []',
    ].join('\n')
  );
  return inputPath;
}

describe('runCliVerify', () => {
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
  });

  it('exits zero immediately after a fresh generation (issue #73 AC2)', async () => {
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-verify-fresh-'));
    try {
      const inputPath = writeBlinkerIpYaml(tmp, '50MHz');
      const genResult = await runCliGenerate(
        { ipYamlPath: inputPath, outDir: tmp, targets: [], hdlLanguage: 'vhdl' },
        resourceRoots
      );
      expect(genResult.success).toBe(true);

      const verifyResult = await runCliVerify(
        { ipYamlPath: inputPath, generatedDir: tmp, targets: [], hdlLanguage: 'vhdl' },
        resourceRoots
      );
      expect(verifyResult.success).toBe(true);
      expect(verifyResult.staleFiles).toEqual([]);
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('agrees with generate when a full-generation pack owns simulation output (issue #156)', async () => {
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-verify-owned-sim-'));
    try {
      const packDir = path.join(tmp, 'owned-sim-pack');
      const outputDir = path.join(tmp, 'generated');
      fs2.mkdirSync(packDir, { recursive: true });
      fs2.writeFileSync(
        path.join(packDir, 'scaffold.yml'),
        [
          'name: "owned-sim-pack"',
          'fullGeneration: true',
          'files:',
          '  - source: custom_tb.vhd.j2',
          '    target: sim/custom_tb.vhd',
          '  - source: Makefile.j2',
          '    target: sim/Makefile',
        ].join('\n')
      );
      fs2.writeFileSync(path.join(packDir, 'custom_tb.vhd.j2'), '-- owned testbench\n');
      fs2.writeFileSync(path.join(packDir, 'Makefile.j2'), 'run:\n\t@echo owned\n');
      const inputPath = writeBlinkerIpYaml(tmp, '50MHz');
      const args = {
        ipYamlPath: inputPath,
        targets: [],
        hdlLanguage: 'vhdl' as const,
        scaffoldPack: packDir,
      };

      const generateResult = await runCliGenerate({ ...args, outDir: outputDir }, resourceRoots);

      expect(generateResult.success).toBe(true);
      expect(generateResult.files).toEqual(['sim/Makefile', 'sim/custom_tb.vhd']);
      expect(fs2.existsSync(path.join(outputDir, 'tb'))).toBe(false);
      expect(fs2.existsSync(path.join(outputDir, '.vscode', 'settings.json'))).toBe(false);

      const verifyResult = await runCliVerify({ ...args, generatedDir: outputDir }, resourceRoots);
      expect(verifyResult).toEqual({ success: true, staleFiles: [] });
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('flags a stale file and exits non-zero after editing the .ip.yml without regenerating (issue #73 AC1, AC3)', async () => {
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-verify-stale-'));
    try {
      const inputPath = writeBlinkerIpYaml(tmp, '50MHz');
      const genResult = await runCliGenerate(
        { ipYamlPath: inputPath, outDir: tmp, targets: ['quartus'], hdlLanguage: 'vhdl' },
        resourceRoots
      );
      expect(genResult.success).toBe(true);

      // Edit the .ip.yml (change frequency) without regenerating.
      writeBlinkerIpYaml(tmp, '100MHz');

      const verifyResult = await runCliVerify(
        { ipYamlPath: inputPath, generatedDir: tmp, targets: ['quartus'], hdlLanguage: 'vhdl' },
        resourceRoots
      );

      expect(verifyResult.success).toBe(false);
      // Names every stale file, not just a boolean.
      expect(verifyResult.staleFiles?.length).toBeGreaterThan(0);
      expect(verifyResult.staleFiles?.some((f) => f.endsWith('led_blink.sdc'))).toBe(true);
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('sets executable: true files +x on generation and never flags a stripped bit as stale (issue #153)', async () => {
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-verify-executable-'));
    try {
      const packDir = path.join(tmp, 'exec-pack');
      fs2.mkdirSync(packDir, { recursive: true });
      fs2.writeFileSync(
        path.join(packDir, 'scaffold.yml'),
        [
          'name: "exec-pack"',
          'fullGeneration: true',
          'files:',
          '  - source: helper_sh.j2',
          '    target: "scripts/{{ name }}_gen.sh"',
          '    executable: true',
        ].join('\n')
      );
      fs2.writeFileSync(path.join(packDir, 'helper_sh.j2'), '#!/bin/sh\necho {{ name }}\n');

      const inputPath = writeBlinkerIpYaml(tmp, '50MHz');
      const genResult = await runCliGenerate(
        {
          ipYamlPath: inputPath,
          outDir: tmp,
          targets: [],
          hdlLanguage: 'vhdl',
          scaffoldPack: packDir,
        },
        resourceRoots
      );
      expect(genResult.success).toBe(true);

      const scriptPath = path.join(tmp, 'scripts', 'led_blink_gen.sh');
      expect(fs2.statSync(scriptPath).mode & 0o111).toBe(0o111);

      // Stripping the executable bit outside IPCraft must not be reported as drift: `verify`
      // diffs content only (documented policy, see src/cli/verify.ts).
      fs2.chmodSync(scriptPath, 0o644);

      const verifyResult = await runCliVerify(
        {
          ipYamlPath: inputPath,
          generatedDir: tmp,
          targets: [],
          hdlLanguage: 'vhdl',
          scaffoldPack: packDir,
        },
        resourceRoots
      );
      expect(verifyResult.success).toBe(true);
      expect(verifyResult.staleFiles).toEqual([]);
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('reports a missing generated file as stale', async () => {
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-verify-missing-'));
    try {
      const inputPath = writeBlinkerIpYaml(tmp, '50MHz');
      const genResult = await runCliGenerate(
        { ipYamlPath: inputPath, outDir: tmp, targets: [], hdlLanguage: 'vhdl' },
        resourceRoots
      );
      expect(genResult.success).toBe(true);

      fs2.rmSync(path.join(tmp, 'rtl', 'led_blink.vhd'));

      const verifyResult = await runCliVerify(
        { ipYamlPath: inputPath, generatedDir: tmp, targets: [], hdlLanguage: 'vhdl' },
        resourceRoots
      );
      expect(verifyResult.success).toBe(false);
      expect(verifyResult.staleFiles).toContain(path.join('rtl', 'led_blink.vhd'));
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('flags an orphaned file left behind in a generated directory (e.g. after a scaffold_pack or --target change)', async () => {
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-verify-orphan-'));
    try {
      const inputPath = writeBlinkerIpYaml(tmp, '50MHz');
      const genResult = await runCliGenerate(
        { ipYamlPath: inputPath, outDir: tmp, targets: [], hdlLanguage: 'vhdl' },
        resourceRoots
      );
      expect(genResult.success).toBe(true);

      // Simulate a file left over from a previous generation with a different pack/target
      // (e.g. scaffold_pack changed, or --target quartus dropped) that a fresh generation no
      // longer produces.
      fs2.writeFileSync(path.join(tmp, 'rtl', 'orphan.vhd'), '-- stale leftover\n');

      const verifyResult = await runCliVerify(
        { ipYamlPath: inputPath, generatedDir: tmp, targets: [], hdlLanguage: 'vhdl' },
        resourceRoots
      );
      expect(verifyResult.success).toBe(false);
      expect(verifyResult.staleFiles).toContain(path.join('rtl', 'orphan.vhd'));
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('flags stale files left in a target directory dropped from a later --target invocation', async () => {
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-verify-dropped-target-'));
    try {
      const inputPath = writeBlinkerIpYaml(tmp, '50MHz');
      const genResult = await runCliGenerate(
        { ipYamlPath: inputPath, outDir: tmp, targets: ['quartus'], hdlLanguage: 'vhdl' },
        resourceRoots
      );
      expect(genResult.success).toBe(true);
      expect(fs2.existsSync(path.join(tmp, 'altera'))).toBe(true);

      // Re-verify without --target quartus (e.g. a later invocation dropped it, or the .ip.yml
      // no longer needs a Quartus project) — the altera/ directory is entirely absent from
      // this run's own generatedContents, but its now-stale files must still be found.
      const verifyResult = await runCliVerify(
        { ipYamlPath: inputPath, generatedDir: tmp, targets: [], hdlLanguage: 'vhdl' },
        resourceRoots
      );
      expect(verifyResult.success).toBe(false);
      expect(verifyResult.staleFiles?.some((f) => f.startsWith('altera' + path.sep))).toBe(true);
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not flag a managed:false file living alongside generated files as orphaned', async () => {
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-verify-orphan-managed-'));
    try {
      // A managed:false file that is NOT itself a scaffold target (unlike issue #75's
      // collision case) — e.g. a hand-authored note living alongside the generated top in
      // the same rtl/ directory. This must be excluded from the orphan scan purely because
      // it's declared managed:false in fileSets, not because it happens to collide with a
      // generated path (result.protectedPaths only covers the latter).
      const inputPath = path.join(tmp, 'led_blink.ip.yml');
      fs2.writeFileSync(
        inputPath,
        [
          'vlnv:',
          '  vendor: test',
          '  library: lib',
          '  name: led_blink',
          '  version: 1.0.0',
          'apiVersion: "1.0"',
          'scaffold_pack: builtin-minimal',
          'clocks:',
          '  - name: clk',
          '    direction: in',
          '    frequency: 50MHz',
          'busInterfaces: []',
          'fileSets:',
          '  - name: RTL_Notes',
          '    files:',
          '      - path: rtl/notes.vhd',
          '        type: vhdl',
          '        managed: false',
        ].join('\n')
      );
      const genResult = await runCliGenerate(
        { ipYamlPath: inputPath, outDir: tmp, targets: [], hdlLanguage: 'vhdl' },
        resourceRoots
      );
      expect(genResult.success).toBe(true);
      // Not a scaffold target (led_blink.vhd is), so it wouldn't exist yet unless hand-authored.
      fs2.writeFileSync(path.join(tmp, 'rtl', 'notes.vhd'), '-- design notes\n');

      const verifyResult = await runCliVerify(
        { ipYamlPath: inputPath, generatedDir: tmp, targets: [], hdlLanguage: 'vhdl' },
        resourceRoots
      );
      expect(verifyResult.success).toBe(true);
      expect(verifyResult.staleFiles).toEqual([]);
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns a readable error instead of a stale-file list when the scaffold pack requirements are unmet (issue #152)', async () => {
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-verify-requirements-'));
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
      // ipcraft verify shares generateAll/buildGenerateOptions with generate, so the same
      // requirements check applies here too.
      const inputPath = path.resolve(__dirname, '../../fixtures/sample-ipcore.yml');
      const result = await runCliVerify(
        {
          ipYamlPath: inputPath,
          generatedDir: tmp,
          targets: [],
          hdlLanguage: 'vhdl',
          scaffoldPack: packDir,
        },
        resourceRoots
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("Scaffold pack 'avalon-only-pack' is incompatible");
      expect(result.staleFiles).toBeUndefined();
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns a readable error for a schema-invalid .ip.yml instead of a stale-file list', async () => {
    const tmp = fs2.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-verify-invalid-'));
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

      const result = await runCliVerify(
        { ipYamlPath: inputPath, generatedDir: tmp, targets: [], hdlLanguage: 'vhdl' },
        resourceRoots
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('simulation.engine');
      expect(result.staleFiles).toBeUndefined();
    } finally {
      fs2.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
