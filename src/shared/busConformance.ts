import type { BusInterface, Parameter } from '../domain/ipcore.types';
import {
  canonicalizeBusType,
  type NormalizedBusLibrary,
  validateBusInterfaces,
} from './busContracts';
import { BUS_VLNV } from './busVlnv';
import { isValidVlnv } from '../utils/vlnv';
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
  let hasBlockingUnresolvedType = false;

  busInterfaces.forEach((busInterface, busIndex) => {
    if (canonicalizeBusType(busInterface.type, library)) {
      return;
    }
    // The generic conduit placeholder and any conduit carrying authored ports need no
    // external bus definition. A conduit with another full VLNV type and no authored
    // ports has no contract at all, so it is reported like any other type.
    if (
      busInterface.mode === 'conduit' &&
      (busInterface.conduitPorts?.length ||
        busInterface.type === BUS_VLNV.CONDUIT ||
        !isValidVlnv(busInterface.type))
    ) {
      return;
    }
    // Imported vendor interfaces keep their literal port maps, which the generator
    // emits without a contract. Report the missing contract, but do not block.
    const rawPortMaps = (busInterface as { rawPortMaps?: readonly unknown[] }).rawPortMaps;
    if (!rawPortMaps?.length) {
      hasBlockingUnresolvedType = true;
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
    // Recommendations (warnings) never block, including a parameter domain too large
    // to enumerate when its default already conforms (design §8.3, §9.2).
    hasUnresolved:
      hasBlockingUnresolvedType ||
      diagnostics.some(
        (diagnostic) =>
          diagnostic.severity === 'error' &&
          (diagnostic.state === 'symbolic' || diagnostic.state === 'unresolved')
      ),
  };
}

export const blocksGeneration = (report: ConformanceReport): boolean =>
  report.hasKnownErrors || report.hasUnresolved;

export const blocksImportWrite = (report: ConformanceReport): boolean => report.hasKnownErrors;
