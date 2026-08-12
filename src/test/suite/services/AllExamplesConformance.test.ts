import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { BusDefinitionFile } from '../../../domain/busDefinition.types';
import type { BusInterface, Parameter } from '../../../domain/ipcore.types';
import { normalizeIpCoreData } from '../../../generator/registerProcessor';
import { blocksGeneration, checkBusConformance } from '../../../shared/busConformance';
import { normalizeBusLibrary, resolveBusInterface } from '../../../shared/busContracts';
import { builtinBusDefinitionSources, builtinBusLibrary } from '../../helpers/busLibrary';

const REPO_ROOT = path.resolve(__dirname, '../../../../');
const EXAMPLES_ROOT = path.join(REPO_ROOT, 'ipcraft-spec/examples');

function filesRecursively(directory: string, suffix: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory()
        ? filesRecursively(absolute, suffix)
        : entry.name.endsWith(suffix)
          ? [absolute]
          : [];
    })
    .sort();
}

function definitionSources(directory: string, sourceKind: 'builtin' | 'ipLocal') {
  return filesRecursively(directory, '.yml').map((sourceFile) => ({
    sourceFile,
    sourceKind,
    definitions: yaml.load(fs.readFileSync(sourceFile, 'utf8')) as BusDefinitionFile,
  }));
}

function loadExample(filePath: string) {
  return yaml.load(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

describe('shipped example bus conformance', () => {
  const exampleFiles = filesRecursively(EXAMPLES_ROOT, '.ip.yml');

  it('has no known errors or unresolved generation constraints', () => {
    const failures: string[] = [];

    for (const exampleFile of exampleFiles) {
      const parsed = loadExample(exampleFile);
      const localLibrary = parsed.useBusLibrary;
      const localSources =
        typeof localLibrary === 'string'
          ? definitionSources(path.resolve(path.dirname(exampleFile), localLibrary), 'ipLocal')
          : [];
      const library = normalizeBusLibrary([...builtinBusDefinitionSources(), ...localSources]);
      const ipCore = normalizeIpCoreData(parsed);
      const report = checkBusConformance(ipCore, library);
      if (
        blocksGeneration(report) ||
        library.diagnostics.some((item) => item.severity === 'error')
      ) {
        failures.push(
          [
            path.relative(EXAMPLES_ROOT, exampleFile),
            ...library.diagnostics.map(
              (item) => `  ${item.code} ${item.path.join('.')}: ${item.message}`
            ),
            ...report.issues.map(
              (item) => `  ${item.code} ${item.path.join('.')}: ${item.message}`
            ),
          ].join('\n')
        );
      }
    }

    expect(failures).toEqual([]);
  });

  it('derives maxChannel 3 for the legacy comprehensive Avalon channel width', () => {
    const exampleFile = path.join(
      EXAMPLES_ROOT,
      'comprehensive_avalon/comprehensive_avalon.ip.yml'
    );
    const parsed = loadExample(exampleFile);
    const ipCore = normalizeIpCoreData(parsed);
    const library = builtinBusLibrary();
    const busIndex = ipCore.busInterfaces?.findIndex((item) => item.name === 'SRC_ST') ?? -1;
    const busInterface = ipCore.busInterfaces?.[busIndex];

    expect(busInterface?.interfaceProperties?.maxChannel).toBeUndefined();
    const resolution = resolveBusInterface({
      busInterface: busInterface as unknown as BusInterface,
      busIndex,
      parameters: (ipCore.parameters ?? []) as unknown as Parameter[],
      library,
    });
    expect(resolution.properties.maxChannel).toEqual(
      expect.objectContaining({ state: 'concrete', value: 3 })
    );
  });
});
