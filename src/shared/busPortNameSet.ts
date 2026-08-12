import { canonicalizeBusType, type NormalizedBusLibrary } from './busContracts';

/** Minimal shape needed to reconstruct a bus interface's physical port names. */
export interface ReconstructableBusInterface {
  type?: string | null;
  physicalPrefix?: string | null;
  portNameOverrides?: Record<string, string> | null;
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
  const match = canonicalizeBusType(iface.type ?? '', library);
  if (!match) {
    const physicalNames = [
      ...(iface.rawPortMaps ?? []).map((port) => port.physical),
      ...(iface.ports ?? []).map((port) => port.name),
    ].filter((name): name is string => typeof name === 'string' && name.length > 0);
    return physicalNames.length > 0
      ? new Set(physicalNames.map((name) => name.toLowerCase()))
      : null;
  }

  const prefix = (iface.physicalPrefix ?? '').toLowerCase();
  const overrides = iface.portNameOverrides ?? {};
  const optional = new Set((iface.useOptionalPorts ?? []).map((name) => name.toUpperCase()));
  const absent = new Set((iface.absentPorts ?? []).map((name) => name.toUpperCase()));
  const names = new Set<string>();

  for (const port of match.contract.ports) {
    if (port.role === 'clock' || port.role === 'reset') {
      continue;
    }
    const upper = port.name.toUpperCase();
    if (absent.has(upper) || (port.presence === 'optional' && !optional.has(upper))) {
      continue;
    }
    const suffix = overrides[port.name] ?? port.name.toLowerCase();
    names.add(`${prefix}${suffix}`.toLowerCase());
  }
  return names;
}
