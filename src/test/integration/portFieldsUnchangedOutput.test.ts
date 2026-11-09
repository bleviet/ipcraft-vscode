/**
 * Port field metadata (`fields`, `portFields`) is metadata only: generated output must not
 * change. Generates the comprehensive_axi example, which carries field metadata, and a copy with
 * every `fields`/`portFields` key removed, then asserts the generated file sets and contents
 * are byte-identical for both HDL languages and the Vivado and Quartus targets.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'yaml';
import { IpCoreScaffolder } from '../../generator/IpCoreScaffolder';
import { TemplateLoader } from '../../generator/TemplateLoader';
import { loadIpCoreData } from '../../generator/loadIpCore';
import { Logger } from '../../utils/Logger';
import { devResourceRoots } from '../../services/ResourceRoots';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const EXAMPLE_DIR = path.join(REPO_ROOT, 'ipcraft-spec/examples/comprehensive_axi');
const EXAMPLE_NAME = 'comprehensive_axi';
const WORK_DIR = path.join(REPO_ROOT, '.test-fixtures', `port-fields-${process.pid}`);

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as unknown as Logger;
const resourceRoots = devResourceRoots(REPO_ROOT);
const scaffolder = new IpCoreScaffolder(
  logger,
  new TemplateLoader(logger, path.join(REPO_ROOT, 'src/generator/templates')),
  resourceRoots
);

/** Remove `fields` from ports and conduit ports and `portFields` from bus interfaces. */
function stripPortFields(doc: Record<string, unknown>): void {
  const ports = (doc.ports ?? []) as Array<Record<string, unknown>>;
  for (const port of ports) {
    delete port.fields;
  }
  const busInterfaces = (doc.busInterfaces ?? []) as Array<Record<string, unknown>>;
  for (const bus of busInterfaces) {
    delete bus.portFields;
    for (const conduitPort of (bus.conduitPorts ?? []) as Array<Record<string, unknown>>) {
      delete conduitPort.fields;
    }
  }
}

/** Copy the example into `<WORK_DIR>/<variant>/`, optionally without field metadata. */
function stageExample(variant: string, withFields: boolean): string {
  const dir = path.join(WORK_DIR, variant);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(
    path.join(EXAMPLE_DIR, `${EXAMPLE_NAME}.mm.yml`),
    path.join(dir, `${EXAMPLE_NAME}.mm.yml`)
  );
  const text = fs.readFileSync(path.join(EXAMPLE_DIR, `${EXAMPLE_NAME}.ip.yml`), 'utf-8');
  let content = text;
  if (!withFields) {
    const data = yaml.parse(text) as Record<string, unknown>;
    stripPortFields(data);
    content = yaml.stringify(data);
  }
  const yamlPath = path.join(dir, `${EXAMPLE_NAME}.ip.yml`);
  fs.writeFileSync(yamlPath, content);
  return yamlPath;
}

async function generate(
  yamlPath: string,
  hdlLanguage: 'vhdl' | 'systemverilog'
): Promise<Record<string, string>> {
  const outputDir = path.join(path.dirname(yamlPath), `out-${hdlLanguage}`);
  const result = await scaffolder.generateAll(yamlPath, outputDir, {
    targets: ['vivado', 'quartus'],
    includeRegs: true,
    includeTestbench: true,
    includeVivadoProject: true,
    includeQuartusProject: true,
    hdlLanguage,
  });
  expect(result.error).toBeUndefined();
  expect(result.success).toBe(true);
  return result.generatedContents ?? {};
}

let withFieldsPath: string;
let withoutFieldsPath: string;

beforeAll(() => {
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
  withFieldsPath = stageExample('with-fields', true);
  withoutFieldsPath = stageExample('without-fields', false);
});

afterAll(() => {
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
});

describe('port field metadata does not change generated output', () => {
  it('the example declares field metadata and passes schema validation', async () => {
    await expect(loadIpCoreData(withFieldsPath, resourceRoots)).resolves.toBeDefined();
    const source = yaml.parse(fs.readFileSync(withFieldsPath, 'utf-8')) as Record<string, unknown>;
    expect(source.apiVersion).toBe('1.2');
    expect(JSON.stringify(source)).toContain('"portFields"');
    expect(JSON.stringify(source)).toContain('"fields"');

    const stripped = yaml.parse(fs.readFileSync(withoutFieldsPath, 'utf-8')) as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(stripped)).not.toMatch(/"portFields"|"fields"/);
    await expect(loadIpCoreData(withoutFieldsPath, resourceRoots)).resolves.toBeDefined();
  });

  it.each(['vhdl', 'systemverilog'] as const)(
    'generates byte-identical files for %s (Vivado and Quartus)',
    async (hdlLanguage) => {
      const withFields = await generate(withFieldsPath, hdlLanguage);
      const withoutFields = await generate(withoutFieldsPath, hdlLanguage);

      expect(Object.keys(withFields).length).toBeGreaterThan(0);
      expect(Object.keys(withFields).sort()).toEqual(Object.keys(withoutFields).sort());
      for (const [relativePath, content] of Object.entries(withFields)) {
        expect({ relativePath, content }).toEqual({
          relativePath,
          content: withoutFields[relativePath],
        });
      }
    },
    300_000
  );
});
