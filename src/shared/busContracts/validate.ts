import { isConsumerInterface } from './canonicalize';
import { resolveBusInterface } from './resolve';
import type { BusConformanceDiagnostic, ValidateBusInterfacesInput } from './types';

export function validateBusInterfaces(
  input: ValidateBusInterfacesInput
): readonly BusConformanceDiagnostic[] {
  const diagnostics: BusConformanceDiagnostic[] = [];

  input.busInterfaces.forEach((busInterface, busIndex) => {
    const resolution = resolveBusInterface({
      busInterface,
      busIndex,
      parameters: input.parameters,
      library: input.library,
    });
    diagnostics.push(...resolution.diagnostics);

    if (!busInterface.memoryMapRef) {
      return;
    }
    const supported =
      resolution.match !== null &&
      resolution.match.contract.interfaceKind === 'memoryMapped' &&
      isConsumerInterface(resolution.match.contract, busInterface.mode) &&
      (busInterface.array?.count === undefined || busInterface.array.count <= 1);
    if (!supported) {
      diagnostics.push({
        code: 'BUS_MEMORY_MAP_UNSUPPORTED',
        ruleId: 'BUS_MEMORY_MAP_UNSUPPORTED',
        severity: 'error',
        state: 'invalid',
        interfaceName: busInterface.name,
        path: ['busInterfaces', busIndex, 'memoryMapRef'],
        message: `Interface '${busInterface.name}' cannot expose a memory map in its current type and mode.`,
      });
    }
  });

  return Object.freeze(diagnostics);
}
