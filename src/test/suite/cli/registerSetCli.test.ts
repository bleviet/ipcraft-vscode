import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildCliScaffolder,
  buildGenerateOptions,
  formatGenerationError,
  runCliGenerate,
} from '../../../cli/generate';
import { runCliVerify } from '../../../cli/verify';
import * as versionGate from '../../../services/versioning/versionGate';
import { Logger } from '../../../utils/Logger';
import { devResourceRoots } from '../../../services/ResourceRoots';
import { BusLibraryService } from '../../../services/BusLibraryService';
import { builtinBusLibrary } from '../../helpers/busLibrary';

jest.mock('../../../utils/Logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

jest.mock('../../../services/BusLibraryService', () => ({ BusLibraryService: jest.fn() }));

jest.mock('../../../services/VivadoInterfaceScanner', () => ({
  getVivadoInterfaceCacheDir: () => '/fake/vivado/cache/bus_definitions',
  pathExists: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../../services/WorkspaceBusDefinitionScanner', () => ({
  getWorkspaceBusDefinitionScanner: () => ({
    scan: jest.fn().mockResolvedValue({ library: {}, files: [], count: 0 }),
  }),
}));

// Real files in a real temp dir: the policy writes the .mm.yml and verify diffs real output.

const repoRoot = path.resolve(__dirname, '../../../..');
const resourceRoots = devResourceRoots(repoRoot);
const fixtures = path.resolve(__dirname, '../../fixtures');

describe('register-set policy through generate and verify', () => {
  let tmp: string;
  let ipPath: string;
  let mmPath: string;
  let outDir: string;

  const writeDesign = (versionRegister = 'resetValue: $version'): void => {
    const ip = fs
      .readFileSync(path.join(fixtures, 'sample-ipcore.yml'), 'utf8')
      .replace('  version: 1.0.0\n', '  version: 1.0.0\n  versionScheme: major.minor.patch\n')
      .replace(/^apiVersion: .*\n/m, '')
      .replace(/^vlnv:/m, "apiVersion: '1.3'\nvlnv:");
    const mm = fs
      .readFileSync(path.join(fixtures, 'sample-memmap.yml'), 'utf8')
      .replace(
        '  - name: RAM\n    baseAddress: 1024',
        `    - name: VERSION\n      offset: 8\n      ${versionRegister}\n  - name: RAM\n    baseAddress: 1024`
      );
    fs.writeFileSync(ipPath, ip);
    fs.writeFileSync(mmPath, mm);
  };
  const args = { targets: [], hdlLanguage: 'vhdl' as const };
  const generate = (registerSetPolicy?: 'adopt' | 'overwrite') =>
    runCliGenerate({ ipYamlPath: ipPath, outDir, registerSetPolicy, ...args }, resourceRoots);
  const verify = () =>
    runCliVerify({ ipYamlPath: ipPath, generatedDir: outDir, ...args }, resourceRoots);

  beforeEach(() => {
    (BusLibraryService as jest.Mock).mockImplementation(() => ({
      loadDefaultSources: jest.fn().mockResolvedValue({ sources: [], diagnostics: [] }),
      loadFromDirectories: jest.fn().mockResolvedValue({ sources: [], diagnostics: [] }),
      normalizeSources: jest.fn(() => builtinBusLibrary()),
      clearCache: jest.fn(),
    }));
    (Logger as unknown as jest.Mock).mockImplementation(() => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }));
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-regset-cli-'));
    ipPath = path.join(tmp, 'sample-ipcore.yml');
    mmPath = path.join(tmp, 'sample-memmap.yml');
    outDir = path.join(tmp, 'out');
    writeDesign();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('generate without the flag fails, names the map and writes nothing', async () => {
    const before = fs.readFileSync(mmPath, 'utf8');
    const result = await generate();

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'MAP: no version recorded yet; re-run with --register-set-policy adopt'
    );
    expect(fs.readFileSync(mmPath, 'utf8')).toBe(before);
    expect(fs.existsSync(outDir)).toBe(false);
  });

  it('generate with adopt records the version, reports it and generates', async () => {
    const result = await generate('adopt');

    expect(result.success).toBe(true);
    expect(result.registerSetsRecorded).toEqual(['MAP: recorded version 1.0.0']);
    const mm = fs.readFileSync(mmPath, 'utf8');
    expect(mm).toContain('versionHistory:');
    expect(mm).toContain('resetValue: $version');
    expect(result.files?.some((f) => f.includes('rtl/sample_core.vhd'))).toBe(true);

    // The recorded design is up to date: no flag is needed any more.
    expect((await generate()).success).toBe(true);
    expect(fs.readFileSync(mmPath, 'utf8')).toBe(mm);
  });

  it('verify never writes and fails for a versioned map that is not up to date', async () => {
    const before = fs.readFileSync(mmPath, 'utf8');
    const result = await verify();

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'MAP: no version recorded yet; re-run with --register-set-policy adopt'
    );
    expect(fs.readFileSync(mmPath, 'utf8')).toBe(before);

    await generate('adopt');
    expect((await verify()).success).toBe(true);

    fs.writeFileSync(
      ipPath,
      fs.readFileSync(ipPath, 'utf8').replace('version: 1.0.0', 'version: 1.0.1')
    );
    const mmRecorded = fs.readFileSync(mmPath, 'utf8');
    const bumped = await verify();
    expect(bumped.success).toBe(false);
    expect(bumped.error).toBe(
      'MAP: version 1.0.1 is not recorded yet; re-run with --register-set-policy adopt'
    );
    expect(fs.readFileSync(mmPath, 'utf8')).toBe(mmRecorded);
  });

  it('leaves a design without a versioned map to generation: a broken map fails as generateAll reports it', async () => {
    fs.writeFileSync(mmPath, '- ~\n');
    const gate = jest.spyOn(versionGate, 'hasVersionGateErrors');

    // What generateAll alone reports, before register-set versioning existed.
    const alone = await buildCliScaffolder(resourceRoots).generateAll(
      ipPath,
      outDir,
      buildGenerateOptions(args)
    );
    expect(alone.success).toBe(false);

    for (const result of [await generate(), await verify()]) {
      expect(result.success).toBe(false);
      expect(result.error).toBe(formatGenerationError(alone));
      expect(result.error).not.toContain('Unexpected error');
      expect(result.error).not.toContain('--register-set-policy');
    }
    expect(gate).not.toHaveBeenCalled();
    expect(fs.existsSync(outDir)).toBe(false);
    gate.mockRestore();
  });

  it('warns once about a missing import of a design without a versioned map', async () => {
    fs.rmSync(mmPath);
    const gate = jest.spyOn(versionGate, 'hasVersionGateErrors');
    const warn = console.warn as jest.Mock;
    warn.mockClear();

    const generated = await generate();
    const generateWarnings = warn.mock.calls.length;
    warn.mockClear();
    const verified = await verify();
    const verifyWarnings = warn.mock.calls.length;
    warn.mockClear();

    expect(generated.success).toBe(false);
    expect(verified.success).toBe(false);
    expect(gate).not.toHaveBeenCalled();
    // Only generation's own warning: the register-set planning adds none.
    expect(generateWarnings).toBe(1);
    expect(verifyWarnings).toBe(1);
    gate.mockRestore();
  });

  it('generate with adopt records nothing for a design the $version gate blocks', async () => {
    writeDesign('resetValue: $version.feature');
    const before = fs.readFileSync(mmPath, 'utf8');
    const result = await generate('adopt');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Generation blocked by $version reference errors.');
    expect(result.error).toContain('$version.feature is not available in version scheme');
    expect(fs.readFileSync(mmPath, 'utf8')).toBe(before);
    expect(fs.readFileSync(mmPath, 'utf8')).not.toContain('versionHistory:');
    expect(fs.existsSync(outDir)).toBe(false);
  });

  it('verify lists the $version gate issues, not only the generic message', async () => {
    // Record the history for a valid design, then make the scheme reject the reference without
    // touching the register layout.
    expect((await generate('adopt')).success).toBe(true);
    fs.writeFileSync(
      ipPath,
      fs
        .readFileSync(ipPath, 'utf8')
        .replace('versionScheme: major.minor.patch', 'versionScheme: free')
    );

    const generated = await generate();
    expect(generated.success).toBe(false);
    expect(generated.error).toContain('Generation blocked by $version reference errors.');
    expect(generated.error).toContain('Version references need a numeric version scheme');

    const result = await verify();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Generation blocked by $version reference errors.');
    expect(result.error).toContain('Version references need a numeric version scheme');
  });

  it('generate and verify report the $version gate errors when the layout also changed', async () => {
    expect((await generate('adopt')).success).toBe(true);
    // The layout changes and the reference becomes invalid: `--register-set-policy adopt` cannot
    // help, so neither command may ask for it.
    fs.writeFileSync(
      mmPath,
      fs
        .readFileSync(mmPath, 'utf8')
        .replace('resetValue: $version', 'resetValue: $version.feature')
        .replace('offset: 8', 'offset: 12')
    );
    const before = fs.readFileSync(mmPath, 'utf8');

    for (const result of [await generate(), await verify()]) {
      expect(result.success).toBe(false);
      expect(result.error).toContain('Generation blocked by $version reference errors.');
      expect(result.error).toContain('$version.feature is not available in version scheme');
      expect(result.error).not.toContain('--register-set-policy');
    }
    expect(fs.readFileSync(mmPath, 'utf8')).toBe(before);
  });
});
