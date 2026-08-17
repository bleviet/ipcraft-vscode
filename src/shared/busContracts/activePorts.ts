import type { BusInterface } from '../../domain/ipcore.types';
import type {
  BusDefinitionContract,
  NormalizedBusPort,
  ResolvedBusPort,
  ResolvedNumericValue,
} from './types';
import {
  resolveEffectivePortPolarity,
  resolveInterfaceRole,
  resolvePhysicalSuffix,
} from './polarity';

function reverseDirection(direction: 'in' | 'out' | undefined): 'in' | 'out' | undefined {
  if (direction === 'in') {
    return 'out';
  }
  if (direction === 'out') {
    return 'in';
  }
  return undefined;
}

export function isPortActive(port: NormalizedBusPort, busInterface: BusInterface): boolean {
  const absent = new Set((busInterface.absentPorts ?? []).map((name) => name.toLowerCase()));
  if (absent.has(port.name.toLowerCase())) {
    return false;
  }
  if (port.presence === 'required') {
    return true;
  }
  const selected = new Set((busInterface.useOptionalPorts ?? []).map((name) => name.toLowerCase()));
  return selected.has(port.name.toLowerCase());
}

export function buildActivePorts(
  contract: BusDefinitionContract,
  busInterface: BusInterface,
  normalizedMode: string | null,
  portWidths: Readonly<Record<string, ResolvedNumericValue>>
): readonly ResolvedBusPort[] {
  const consumer = normalizedMode === contract.modePolicy.consumer;
  return Object.freeze(
    contract.ports
      .filter((port) => isPortActive(port, busInterface))
      .map((port) => ({
        ...port,
        effectivePolarity: resolveEffectivePortPolarity(port, busInterface),
        interfaceRole: resolveInterfaceRole(port, busInterface),
        physicalSuffix: resolvePhysicalSuffix(port, busInterface),
        needsPolarityInversion: resolveEffectivePortPolarity(port, busInterface) === 'activeLow',
        effectiveDirection: consumer ? reverseDirection(port.direction) : port.direction,
        effectiveWidth: portWidths[port.name],
      }))
  );
}
