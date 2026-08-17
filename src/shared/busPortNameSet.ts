import type { BusInterface, Parameter } from '../domain/ipcore.types';
import { resolveBusInterface, type NormalizedBusLibrary } from './busContracts';

/** Minimal shape needed to reconstruct a bus interface's physical port names. */
export interface ReconstructableBusInterface {
  type?: string | null;
  mode?: string | null;
  physicalPrefix?: string | null;
  portNameOverrides?: Record<string, string> | null;
  portPolarityOverrides?: Record<string, 'activeHigh' | 'activeLow'> | null;
  useOptionalPorts?: string[] | null;
  absentPorts?: string[] | null;
  ports?: Array<{ name?: string | null }> | null;
  rawPortMaps?: Array<{ physical?: string | null }> | null;
}

/** Reconstruct the physical port names emitted for one bus interface. */
export function reconstructBusPortNameSet(
  iface: ReconstructableBusInterface,
  library: NormalizedBusLibrary
): Set<string> | null {
  const resolution = resolveBusInterface({
    busInterface: { ...iface, mode: iface.mode ?? '' } as BusInterface,
    busIndex: 0,
    parameters: [] as Parameter[],
    library,
  });
  if (!resolution.match) {
    const physicalNames = [
      ...(iface.rawPortMaps ?? []).map((port) => port.physical),
      ...(iface.ports ?? []).map((port) => port.name),
    ].filter((name): name is string => typeof name === 'string' && name.length > 0);
    return physicalNames.length > 0
      ? new Set(physicalNames.map((name) => name.toLowerCase()))
      : null;
  }

  const prefix = (iface.physicalPrefix ?? '').toLowerCase();
  const names = new Set<string>();

  for (const port of resolution.activePorts) {
    if (port.role === 'clock' || port.role === 'reset') {
      continue;
    }
    names.add(`${prefix}${port.physicalSuffix}`.toLowerCase());
  }
  return names;
}
