import * as yaml from 'js-yaml';
import { IpCoreSchemaValidationError, loadIpCoreData } from '../generator/loadIpCore';
import type { NormalizedBusLibrary } from '../shared/busContracts';
import { checkBusConformance } from '../shared/busConformance';
import type { ConformanceReport } from '../shared/issues';
import type { ResourceRoots } from './ResourceRoots';

/**
 * Checks an importer's YAML before it is previewed or written. A schema problem is
 * reported with the bus-conformance issues instead of being thrown: the design writes
 * an imported file with warnings unless a known protocol error exists, so the user can
 * fix the result in the editor (design 2026-08-11, section 9.2).
 *
 * A known error proves an interface wrong only when the importer read it completely.
 * Errors on interfaces the importer marks as statically incomplete (values computed at
 * elaboration time) are reported but do not block the write; generation stays strict.
 */
export async function checkImportedIpCore(input: {
  sourcePath: string;
  yamlText: string;
  resourceRoots: ResourceRoots;
  loadBusLibrary: (ipCoreData: Record<string, unknown>) => Promise<NormalizedBusLibrary>;
  staticallyIncompleteInterfaces?: readonly string[];
}): Promise<ConformanceReport> {
  let ipCoreData: Record<string, unknown>;
  let schemaIssues: ConformanceReport['issues'] = [];
  try {
    ipCoreData = await loadIpCoreData(input.sourcePath, input.resourceRoots, input.yamlText);
  } catch (error) {
    if (!(error instanceof IpCoreSchemaValidationError)) {
      throw error;
    }
    schemaIssues = error.issues;
    ipCoreData = yaml.load(input.yamlText) as Record<string, unknown>;
  }
  const library = await input.loadBusLibrary(ipCoreData);
  const report = checkBusConformance(ipCoreData, library);
  const incomplete = new Set(input.staticallyIncompleteInterfaces ?? []);
  const hasKnownErrors =
    report.hasKnownErrors && incomplete.size > 0
      ? checkBusConformance(
          {
            ...ipCoreData,
            busInterfaces: ((ipCoreData.busInterfaces as unknown[] | undefined) ?? []).filter(
              (busInterface) => !incomplete.has((busInterface as { name?: string }).name ?? '')
            ),
          },
          library
        ).hasKnownErrors
      : report.hasKnownErrors;
  return { ...report, hasKnownErrors, issues: [...schemaIssues, ...report.issues] };
}
