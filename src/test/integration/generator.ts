/**
 * Generates test fixtures from all template and example IP-core YAMLs.
 *
 * Sources:
 *   - ipcraft-spec/templates/   flat directory of *.ip.yml files
 *   - ipcraft-spec/examples/    one subdirectory per example, each containing
 *                               one or more *.ip.yml files
 *
 * Calls IpCoreScaffolder.generateAll with real bus definitions loaded from
 * dist/resources/bus_definitions/ and any per-IP useBusLibrary paths.
 * Outputs files to a stable directory under os.tmpdir() so subsequent calls
 * within the same Jest run reuse the same files.
 *
 * Output layout:
 *   <FIXTURE_BASE>/
 *     <template-name>/          # from ipcraft-spec/templates/
 *     examples/<subdir-name>/   # from ipcraft-spec/examples/<subdir>/
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
const EXAMPLES_DIR = path.join(REPO_ROOT, 'ipcraft-spec/examples');
const GENERATOR_TEMPLATES = path.join(REPO_ROOT, 'src/generator/templates');
export const FIXTURE_BASE = path.join(os.tmpdir(), 'ipcraft-integration-fixtures');

export interface Fixture {
  name: string;
  yamlPath: string;
  outputDir: string;
  success: boolean;
  files: Record<string, string>;
}

interface YamlSource {
  /** Human-readable fixture name, also used as the relative output path. */
  name: string;
  yamlPath: string;
}

/** Collect *.ip.yml files from the flat templates directory. */
function collectTemplateSources(): YamlSource[] {
  return nodefs
    .readdirSync(TEMPLATES_DIR)
    .filter((f) => f.endsWith('.ip.yml'))
    .sort()
    .map((f) => ({
      name: path.basename(f, '.ip.yml'),
      yamlPath: path.join(TEMPLATES_DIR, f),
    }));
}

/**
 * Collect *.ip.yml files from each subdirectory of the examples directory.
 * Fixture names are prefixed with "examples/<subdir>" to avoid collisions
 * with template fixture names.
 */
function collectExampleSources(): YamlSource[] {
  const sources: YamlSource[] = [];

  const subdirs = nodefs
    .readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const subdir of subdirs) {
    const dirPath = path.join(EXAMPLES_DIR, subdir);
    const ipYamls = nodefs
      .readdirSync(dirPath)
      .filter((f) => f.endsWith('.ip.yml'))
      .sort();

    for (const f of ipYamls) {
      sources.push({
        name: `examples/${subdir}`,
        yamlPath: path.join(dirPath, f),
      });
    }
  }

  return sources;
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

  const sources: YamlSource[] = [...collectTemplateSources(), ...collectExampleSources()];

  await nodefsp.mkdir(FIXTURE_BASE, { recursive: true });

  const fixtures: Fixture[] = [];

  for (const { name, yamlPath } of sources) {
    const outputDir = path.join(FIXTURE_BASE, ...name.split('/'));
    await nodefsp.mkdir(path.dirname(outputDir), { recursive: true });

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

/** Return all fixtures that produced a component.xml (Xilinx/Vivado output). */
export function xilinxFixtures(fixtures: Fixture[]): Fixture[] {
  return fixtures.filter((f) =>
    nodefs.existsSync(path.join(f.outputDir, 'xilinx', 'component.xml'))
  );
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
