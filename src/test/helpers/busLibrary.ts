import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { BusDefinitionFile } from '../../domain/busDefinition.types';
import {
  normalizeBusLibrary,
  type BusDefinitionSource,
  type NormalizedBusLibrary,
} from '../../shared/busContracts';

let cached: NormalizedBusLibrary | undefined;
let cachedSources: BusDefinitionSource[] | undefined;
let cachedDefinitions: BusDefinitionFile | undefined;

export function builtinBusDefinitionSources(): BusDefinitionSource[] {
  cachedSources ??= fs
    .readdirSync(path.resolve(__dirname, '../../../ipcraft-spec/bus_definitions'))
    .filter((name) => name.endsWith('.yml'))
    .sort()
    .map((name) => {
      const sourceFile = path.resolve(__dirname, '../../../ipcraft-spec/bus_definitions', name);
      return {
        sourceFile,
        sourceKind: 'builtin' as const,
        definitions: yaml.load(fs.readFileSync(sourceFile, 'utf8')) as BusDefinitionFile,
      };
    });
  return cachedSources;
}

export function builtinBusDefinitions(): BusDefinitionFile {
  if (!cachedDefinitions) {
    cachedDefinitions = {};
    for (const source of builtinBusDefinitionSources()) {
      Object.assign(cachedDefinitions, source.definitions);
    }
  }
  return cachedDefinitions;
}

/** Load the checked-in built-ins for tests that exercise injected protocol consumers. */
export function builtinBusLibrary(): NormalizedBusLibrary {
  cached ??= normalizeBusLibrary(builtinBusDefinitionSources());
  return cached;
}
