/**
 * Generates test fixtures from all template IP-core YAMLs.
 *
 * Calls IpCoreScaffolder.generateAll with real bus definitions loaded from
 * dist/resources/bus_definitions/ and any per-IP useBusLibrary paths.
 * Outputs files to a stable directory under os.tmpdir() so subsequent calls
 * within the same Jest run reuse the same files.
 */

import * as path from 'path';
import * as os from 'os';
import * as nodefs from 'fs';
import * as nodefsp from 'fs/promises';
import { IpCoreScaffolder } from '../../generator/IpCoreScaffolder';
import { TemplateLoader } from '../../generator/TemplateLoader';
import { Logger } from '../../utils/Logger';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const TEMPLATES_DIR = path.join(REPO_ROOT, 'ipcraft-spec/templates');
const GENERATOR_TEMPLATES = path.join(REPO_ROOT, 'src/generator/templates');
export const FIXTURE_BASE = path.join(os.tmpdir(), 'ipcraft-integration-fixtures');

export interface Fixture {
  name: string;
  yamlPath: string;
  outputDir: string;
  success: boolean;
  files: Record<string, string>;
}

let cache: Fixture[] | null = null;

/**
 * Generates fixtures once per process and caches the result.
 * Call from beforeAll() inside any integration test suite.
 */
export async function generateFixtures(): Promise<Fixture[]> {
  if (cache) {
    return cache;
  }

  const logger = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  } as unknown as Logger;

  const loader = new TemplateLoader(logger, GENERATOR_TEMPLATES);
  const context = { extensionPath: REPO_ROOT } as unknown as import('vscode').ExtensionContext;
  const scaffolder = new IpCoreScaffolder(logger, loader, context);

  const entries = nodefs.readdirSync(TEMPLATES_DIR);
  const ipYamls = entries
    .filter((f) => f.endsWith('.ip.yml'))
    .sort()
    .map((f) => path.join(TEMPLATES_DIR, f));

  await nodefsp.mkdir(FIXTURE_BASE, { recursive: true });

  const fixtures: Fixture[] = [];

  for (const yamlPath of ipYamls) {
    const name = path.basename(yamlPath, '.ip.yml');
    const outputDir = path.join(FIXTURE_BASE, name);
    await nodefsp.mkdir(outputDir, { recursive: true });

    // Fresh generation — remove stale files first
    await nodefsp.rm(outputDir, { recursive: true, force: true });
    await nodefsp.mkdir(outputDir, { recursive: true });

    const result = await scaffolder.generateAll(yamlPath, outputDir, {
      vendor: 'both',
      includeRegs: true,
    });

    fixtures.push({
      name,
      yamlPath,
      outputDir,
      success: result.success,
      files: result.files ?? {},
    });

    if (!result.success) {
      console.warn(`[integration] Generation failed for ${name}: ${result.error}`);
    }
  }

  cache = fixtures;
  return fixtures;
}

/** Return all fixtures that produced a component.xml (AMD/Vivado output). */
export function amdFixtures(fixtures: Fixture[]): Fixture[] {
  return fixtures.filter((f) => nodefs.existsSync(path.join(f.outputDir, 'amd', 'component.xml')));
}

/** Return all fixtures that produced a hw.tcl (Altera/Quartus output). */
export function alteraFixtures(fixtures: Fixture[]): Fixture[] {
  return fixtures.filter((f) => {
    const alteraDir = path.join(f.outputDir, 'altera');
    return (
      nodefs.existsSync(alteraDir) &&
      nodefs.readdirSync(alteraDir).some((f) => f.endsWith('_hw.tcl'))
    );
  });
}

/** Return the full path to the generated hw.tcl files for a fixture. */
export function hwTclFiles(fixture: Fixture): string[] {
  const alteraDir = path.join(fixture.outputDir, 'altera');
  if (!nodefs.existsSync(alteraDir)) {
    return [];
  }
  return nodefs
    .readdirSync(alteraDir)
    .filter((f) => f.endsWith('_hw.tcl'))
    .map((f) => path.join(alteraDir, f));
}
