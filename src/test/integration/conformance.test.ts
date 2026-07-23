/**
 * Pack conformance kit — Tier 0.
 *
 * Verifies that every built-in scaffold pack:
 *   1. Declares an apiVersion compatible with CONTRACT_VERSION.
 *   2. Generates successfully against a representative fixture (no contract violation).
 *
 * Third-party pack authors can run this same harness by passing:
 *   CONFORMANCE_PACK_DIR=/path/to/my-pack
 *   CONFORMANCE_FIXTURE=/path/to/ip_core.ip.yml
 * Both variables must be set together to activate the third-party pack path.
 *
 * Requires no vendor tools — pure Node generation (Tier 0).
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as fsp from 'fs/promises';
import { ScaffoldPackLoader } from '../../generator/ScaffoldPackLoader';
import { checkPackApiVersion, CONTRACT_VERSION } from '../../generator/contract';
import { IpCoreScaffolder } from '../../generator/IpCoreScaffolder';
import { TemplateLoader } from '../../generator/TemplateLoader';
import { Logger } from '../../utils/Logger';
import { devResourceRoots } from '../../services/ResourceRoots';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const GENERATOR_TEMPLATES = path.join(REPO_ROOT, 'src', 'generator', 'templates');
const TEMPLATES_DIR = path.join(REPO_ROOT, 'ipcraft-spec', 'templates');

function silentLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  } as unknown as Logger;
}

/** Pick the first .ip.yml in ipcraft-spec/templates as the representative fixture. */
function firstTemplateFixture(): string {
  const files = fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.ip.yml'));
  if (files.length === 0) {
    throw new Error(`No .ip.yml files found in ${TEMPLATES_DIR}`);
  }
  return path.join(TEMPLATES_DIR, files.sort()[0]);
}

const resourceRoots = devResourceRoots(REPO_ROOT);
const loader = new ScaffoldPackLoader(resourceRoots.builtinPacksDir);

// ---------------------------------------------------------------------------
// 1. Built-in pack manifest conformance (no generation needed)
// ---------------------------------------------------------------------------

describe('built-in pack apiVersion declarations', () => {
  const packNames = loader.listBuiltinPacks();

  it('finds at least one built-in pack', () => {
    expect(packNames.length).toBeGreaterThan(0);
  });

  for (const packName of packNames) {
    describe(`pack: ${packName}`, () => {
      const pack = loader.resolve(packName);

      it('declares apiVersion', () => {
        expect(pack.apiVersion).toBeDefined();
        expect(typeof pack.apiVersion).toBe('string');
        expect((pack.apiVersion as string).length).toBeGreaterThan(0);
      });

      it('apiVersion is compatible with CONTRACT_VERSION', () => {
        expect(() => checkPackApiVersion(pack)).not.toThrow();
      });

      it('CONTRACT_VERSION is 1.1.0', () => {
        expect(CONTRACT_VERSION).toBe('1.1.0');
      });
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Version mismatch is rejected with a clear error
// ---------------------------------------------------------------------------

describe('apiVersion mismatch', () => {
  it('rejects a pack targeting an incompatible major version', () => {
    expect(() =>
      checkPackApiVersion({
        name: 'hypothetical-v2-pack',
        packDir: '/tmp/hypothetical',
        files: [],
        apiVersion: '^2.0',
      })
    ).toThrow(/hypothetical-v2-pack/);
  });
});

// ---------------------------------------------------------------------------
// 3. Each built-in pack generates successfully (contract validity via assertValidContext)
// ---------------------------------------------------------------------------

describe('built-in pack generation conformance', () => {
  const packNames = loader.listBuiltinPacks();
  const fixtureYaml = firstTemplateFixture();
  let outBase: string;

  beforeAll(async () => {
    outBase = path.join(os.tmpdir(), `ipcraft-conformance-${process.pid}`);
    await fsp.mkdir(outBase, { recursive: true });
  });

  afterAll(async () => {
    await fsp.rm(outBase, { recursive: true, force: true });
  });

  for (const packName of packNames) {
    it(`pack '${packName}' generates without contract violation`, async () => {
      const outDir = path.join(outBase, packName);
      await fsp.mkdir(outDir, { recursive: true });

      const templateLoader = new TemplateLoader(silentLogger(), GENERATOR_TEMPLATES);
      const scaffolder = new IpCoreScaffolder(silentLogger(), templateLoader, resourceRoots);

      const result = await scaffolder.generateAll(fixtureYaml, outDir, {
        scaffoldPack: packName,
        includeRegs: true,
        includeTestbench: false,
      });

      expect(result.success).toBe(true);
    }, 30_000);
  }
});

// ---------------------------------------------------------------------------
// 4. Third-party pack path (opt-in via env vars)
// ---------------------------------------------------------------------------

const thirdPartyPackDir = process.env['CONFORMANCE_PACK_DIR'];
const thirdPartyFixture = process.env['CONFORMANCE_FIXTURE'];
const thirdPartyEnabled = Boolean(thirdPartyPackDir && thirdPartyFixture);

(thirdPartyEnabled ? describe : describe.skip)('third-party pack conformance', () => {
  it('declares apiVersion', () => {
    const pack = ScaffoldPackLoader.load(thirdPartyPackDir!);
    expect(pack.apiVersion).toBeDefined();
  });

  it('apiVersion is compatible with CONTRACT_VERSION', () => {
    const pack = ScaffoldPackLoader.load(thirdPartyPackDir!);
    expect(() => checkPackApiVersion(pack)).not.toThrow();
  });

  it('generates against provided fixture without contract violation', async () => {
    const outDir = path.join(os.tmpdir(), `ipcraft-conformance-3p-${process.pid}`);
    await fsp.mkdir(outDir, { recursive: true });

    const templateLoader = new TemplateLoader(silentLogger(), GENERATOR_TEMPLATES);
    const scaffolder = new IpCoreScaffolder(silentLogger(), templateLoader, resourceRoots);

    const result = await scaffolder.generateAll(thirdPartyFixture!, outDir, {
      // Pass the full pack directory path so the pack resolves directly,
      // independent of workspace/built-in search paths.
      scaffoldPack: thirdPartyPackDir!,
      includeRegs: true,
      includeTestbench: false,
    });

    await fsp.rm(outDir, { recursive: true, force: true });
    expect(result.success).toBe(true);
  }, 30_000);
});
