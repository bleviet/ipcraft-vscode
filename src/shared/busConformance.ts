import type { BusInterface, Parameter } from '../domain/ipcore.types';
import {
  canonicalizeBusType,
  type NormalizedBusLibrary,
  validateBusInterfaces,
} from './busContracts';
import { deduplicateIssues, type ConformanceReport, type IpcraftIssue } from './issues';

export interface BusConformanceInput {
  busInterfaces?: readonly unknown[];
  parameters?: readonly unknown[];
}

export function checkBusConformance(
  ipCore: BusConformanceInput,
  library: NormalizedBusLibrary
): ConformanceReport {
  // Documents reach this shared boundary through generated domain types, the
  // tolerant generator model, and the legacy webview model. Runtime schema
  // validation guarantees the same contract shape; keep the compatibility
  // adaptation here instead of repeating type erosion at every caller.
  const busInterfaces = (ipCore.busInterfaces ?? []) as readonly BusInterface[];
  const parameters = (ipCore.parameters ?? []) as readonly Parameter[];
  const diagnostics = validateBusInterfaces({ busInterfaces, parameters, library });
  const unresolvedIssues: IpcraftIssue[] = [];

  busInterfaces.forEach((busInterface, busIndex) => {
    if (canonicalizeBusType(busInterface.type, library)) {
      return;
    }
    // Inline conduits carry their complete signal contract in the document and do not
    // require an external bus definition.
    if (busInterface.mode === 'conduit' && (busInterface.conduitPorts?.length ?? 0) > 0) {
      return;
    }
    unresolvedIssues.push({
      code: 'BUS_TYPE_UNRESOLVED',
      severity: 'warning',
      source: 'protocol',
      path: ['busInterfaces', busIndex, 'type'],
      interfaceName: busInterface.name,
      message: `Bus type '${busInterface.type}' could not be resolved in the active bus library.`,
    });
  });

  const issues = deduplicateIssues([
    ...diagnostics.map(
      (diagnostic): IpcraftIssue => ({
        code: diagnostic.code,
        severity: diagnostic.severity,
        source: 'protocol',
        path: diagnostic.path,
        message: diagnostic.message,
        interfaceName: diagnostic.interfaceName,
      })
    ),
    ...unresolvedIssues,
  ]);

  return {
    issues: Object.freeze(issues),
    hasKnownErrors: diagnostics.some(
      (diagnostic) =>
        diagnostic.severity === 'error' &&
        (diagnostic.state === 'concrete' || diagnostic.state === 'invalid')
    ),
    hasUnresolved:
      unresolvedIssues.length > 0 ||
      diagnostics.some(
        (diagnostic) => diagnostic.state === 'symbolic' || diagnostic.state === 'unresolved'
      ),
  };
}

export const blocksGeneration = (report: ConformanceReport): boolean =>
  report.hasKnownErrors || report.hasUnresolved;

export const blocksImportWrite = (report: ConformanceReport): boolean => report.hasKnownErrors;
