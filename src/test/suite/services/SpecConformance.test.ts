import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv';
import * as jsyaml from 'js-yaml';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const FIXTURES_DIR = path.join(REPO_ROOT, 'src', 'test', 'fixtures');
const TEMPLATES_DIR = path.join(REPO_ROOT, 'ipcraft-spec', 'templates');
const EXAMPLES_DIR = path.join(REPO_ROOT, 'ipcraft-spec', 'examples');

const IP_CORE_SCHEMA_PATH = path.join(REPO_ROOT, 'ipcraft-spec', 'schemas', 'ip_core.schema.json');
const MEMORY_MAP_SCHEMA_PATH = path.join(
  REPO_ROOT,
  'ipcraft-spec',
  'schemas',
  'memory_map.schema.json'
);

describe('Spec Conformance Tests', () => {
  let ajv: Ajv;
  let validateIpCore: ReturnType<Ajv['compile']>;
  let validateMemoryMap: ReturnType<Ajv['compile']>;

  beforeAll(() => {
    ajv = new Ajv({ strict: false, allowUnionTypes: true });

    // Load and compile IP Core schema
    const ipCoreSchema = JSON.parse(fs.readFileSync(IP_CORE_SCHEMA_PATH, 'utf8'));
    validateIpCore = ajv.compile(ipCoreSchema);

    // Load, hoist defs, and compile Memory Map schema
    const rawMemoryMapSchema = JSON.parse(fs.readFileSync(MEMORY_MAP_SCHEMA_PATH, 'utf8'));
    const memoryMapSchema = {
      ...rawMemoryMapSchema,
      $defs: rawMemoryMapSchema.items?.$defs,
    };
    validateMemoryMap = ajv.compile(memoryMapSchema);
  });

  function getYamlFiles(dir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(dir)) {
      return results;
    }

    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        const skipDirs = new Set([
          'custom_bus_definitions',
          'build',
          'sim',
          'CMakeFiles',
          'node_modules',
          '.git',
          'dist',
          'out',
          '__pycache__',
          '.pytest_cache',
        ]);
        if (skipDirs.has(file)) {
          continue;
        }
        results.push(...getYamlFiles(fullPath));
      } else if (file.endsWith('.yml') || file.endsWith('.yaml')) {
        results.push(fullPath);
      }
    }
    return results;
  }

  const allYamlFiles = [
    ...getYamlFiles(FIXTURES_DIR),
    ...getYamlFiles(TEMPLATES_DIR),
    ...getYamlFiles(EXAMPLES_DIR),
  ].filter(
    // .board.yml has its own schema (board.schema.json) that this sweep doesn't load —
    // without this exclusion it falls through to the ip-core/memory-map binary classifier
    // below and gets validated against the wrong schema.
    (f) => !f.includes('invalid-syntax') && !f.endsWith('.board.yml')
  );

  for (const filePath of allYamlFiles) {
    const relativePath = path.relative(REPO_ROOT, filePath);

    it(`should conform to schema: ${relativePath}`, () => {
      const content = fs.readFileSync(filePath, 'utf8');
      const doc = jsyaml.load(content) as Record<string, unknown> | unknown[];

      if (!doc) {
        throw new Error(`Failed to parse YAML file: ${relativePath}`);
      }

      const isIpCore =
        filePath.endsWith('.ip.yml') ||
        relativePath.includes('-ipcore') ||
        (typeof doc === 'object' && !Array.isArray(doc) && 'vlnv' in doc);

      if (isIpCore) {
        const valid = validateIpCore(doc);
        if (!valid) {
          const errors = validateIpCore.errors
            ? JSON.stringify(validateIpCore.errors, null, 2)
            : 'Unknown validation error';
          expect(`IP Core schema validation errors for ${relativePath}:\n${errors}`).toBe('');
        }
      } else {
        // Must be a Memory Map
        const arrayDoc = Array.isArray(doc) ? doc : [doc];
        const valid = validateMemoryMap(arrayDoc);
        if (!valid) {
          const errors = validateMemoryMap.errors
            ? JSON.stringify(validateMemoryMap.errors, null, 2)
            : 'Unknown validation error';
          expect(`Memory Map schema validation errors for ${relativePath}:\n${errors}`).toBe('');
        }
      }
    });
  }
});
