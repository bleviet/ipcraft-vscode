import type { NormalizedBusPort } from './types';

export interface ObservedBusPort {
  logicalName: string;
  physicalName: string;
  width?: number | string;
}

export interface ObservedBusPortSelections {
  useOptionalPorts?: string[];
  portWidthOverrides?: Record<string, number | string>;
  portNameOverrides?: Record<string, string>;
}

/** Reconcile vendor-observed ports with canonical contract selections. */
export function reconcileObservedBusPorts(
  contractPorts: readonly NormalizedBusPort[],
  observedPorts: readonly ObservedBusPort[],
  physicalPrefix: string
): ObservedBusPortSelections {
  const definitionByUpper = new Map(contractPorts.map((port) => [port.name.toUpperCase(), port]));
  const present = new Set(observedPorts.map((port) => port.logicalName.toUpperCase()));
  const useOptionalPorts = contractPorts
    .filter((port) => port.presence === 'optional' && present.has(port.name.toUpperCase()))
    .map((port) => port.name);
  const portWidthOverrides: Record<string, number | string> = {};
  const portNameOverrides: Record<string, string> = {};

  for (const observed of observedPorts) {
    const definition = definitionByUpper.get(observed.logicalName.toUpperCase());
    if (!definition) {
      continue;
    }
    if (
      observed.width !== undefined &&
      typeof definition.width === 'number' &&
      (typeof observed.width === 'string' || observed.width !== definition.width)
    ) {
      portWidthOverrides[definition.name] = observed.width;
    }

    const suffix = observed.physicalName.startsWith(physicalPrefix)
      ? observed.physicalName.slice(physicalPrefix.length)
      : observed.physicalName;
    if (suffix !== observed.logicalName.toLowerCase()) {
      portNameOverrides[definition.name] = suffix;
    }
  }

  return {
    ...(useOptionalPorts.length > 0 ? { useOptionalPorts } : {}),
    ...(Object.keys(portWidthOverrides).length > 0 ? { portWidthOverrides } : {}),
    ...(Object.keys(portNameOverrides).length > 0 ? { portNameOverrides } : {}),
  };
}
