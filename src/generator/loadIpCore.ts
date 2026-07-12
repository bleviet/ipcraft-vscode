import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { YamlValidator } from '../services/YamlValidator';
import type { ResourceRoots } from '../services/ResourceRoots';
import { normalizeParameterDataType } from '../parser/paramDataType';
import { normalizeIpCoreData } from './registerProcessor';
import type { IpCoreData } from './types';

const validator = new YamlValidator();

/**
 * Load, canonicalise, and schema-validate an .ip.yml file into normalized IpCoreData.
 * Shared by IpCoreScaffolder and BoardProjectScaffolder so both start from the exact same
 * validated, normalized data.
 */
export async function loadIpCoreData(
  inputPath: string,
  resourceRoots: ResourceRoots
): Promise<IpCoreData> {
  const content = await fs.readFile(inputPath, 'utf8');
  const parsed = yaml.load(content);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid IP core YAML');
  }
  // Canonicalise HDL parameter types (e.g. `positive` -> `natural`) so that
  // hand-written specs validate and the generator emits a valid HDL generic
  // type. Importers already normalise; this covers the direct-YAML path.
  const params = (parsed as Record<string, unknown>).parameters;
  if (Array.isArray(params)) {
    for (const p of params) {
      if (p && typeof p === 'object' && 'dataType' in p) {
        const param = p as Record<string, unknown>;
        param.dataType = normalizeParameterDataType(param.dataType as string | undefined);
      }
    }
  }
  const schemaPath = path.join(resourceRoots.schemasDir, 'ip_core.schema.json');
  const schemaResult = validator.validateAgainstSchema(parsed, schemaPath);
  if (!schemaResult.valid) {
    throw new Error(`IP core YAML schema validation failed: ${schemaResult.error}`);
  }
  return normalizeIpCoreData(parsed as Record<string, unknown>);
}
