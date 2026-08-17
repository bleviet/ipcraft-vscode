import { matchBusPortRole } from './polarity';
import type { NormalizedBusPort, PortPolarity } from './types';

export interface ObservedBusPort {
  logicalName: string;
  physicalName: string;
  width?: number | string;
}

export interface ObservedBusPortSelections {
  useOptionalPorts?: string[];
  portWidthOverrides?: Record<string, number | string>;
  portNameOverrides?: Record<string, string>;
  portPolarityOverrides?: Record<string, PortPolarity>;
}

/** Reconcile vendor-observed ports with canonical contract selections. */
export function reconcileObservedBusPorts(
  contractPorts: readonly NormalizedBusPort[],
  observedPorts: readonly ObservedBusPort[],
  physicalPrefix: string
): ObservedBusPortSelections {
  const present = new Set<string>();
  const portWidthOverrides: Record<string, number | string> = {};
  const portNameOverrides: Record<string, string> = {};
  const portPolarityOverrides: Record<string, PortPolarity> = {};

  for (const observed of observedPorts) {
    const match = matchBusPortRole(contractPorts, observed.logicalName);
    if (!match) {
      continue;
    }
    const definition = match.port;
    present.add(definition.name.toUpperCase());
    if (
      observed.width !== undefined &&
      typeof definition.width === 'number' &&
      (typeof observed.width === 'string' || observed.width !== definition.width)
    ) {
      portWidthOverrides[definition.name] = observed.width;
    } else if (observed.width !== undefined) {
      delete portWidthOverrides[definition.name];
    }

    const suffix = observed.physicalName.startsWith(physicalPrefix)
      ? observed.physicalName.slice(physicalPrefix.length)
      : observed.physicalName;
    const selectedPolarity = match.polarity ?? definition.polarity?.default;
    const defaultSuffix = definition.polarity
      ? definition.polarity.roles[selectedPolarity ?? definition.polarity.default]
      : definition.name.toLowerCase();
    if (suffix !== defaultSuffix) {
      portNameOverrides[definition.name] = suffix;
    } else {
      delete portNameOverrides[definition.name];
    }

    if (
      definition.polarity &&
      selectedPolarity !== undefined &&
      selectedPolarity !== definition.polarity.default
    ) {
      portPolarityOverrides[definition.name] = selectedPolarity;
    } else {
      delete portPolarityOverrides[definition.name];
    }
  }

  const useOptionalPorts = contractPorts
    .filter((port) => port.presence === 'optional' && present.has(port.name.toUpperCase()))
    .map((port) => port.name);

  return {
    ...(useOptionalPorts.length > 0 ? { useOptionalPorts } : {}),
    ...(Object.keys(portWidthOverrides).length > 0 ? { portWidthOverrides } : {}),
    ...(Object.keys(portNameOverrides).length > 0 ? { portNameOverrides } : {}),
    ...(Object.keys(portPolarityOverrides).length > 0 ? { portPolarityOverrides } : {}),
  };
}
