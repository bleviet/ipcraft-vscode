import { lookupBusDef } from '../webview/ipcore/data/busDefinitions';

/** Minimal shape needed to reconstruct a bus interface's physical port names. */
export interface ReconstructableBusInterface {
  type?: string | null;
  physicalPrefix?: string | null;
  portNameOverrides?: Record<string, string> | null;
  useOptionalPorts?: string[] | null;
  absentPorts?: string[] | null;
}

/**
 * Reconstructs the full set of physical port names a standard bus interface will emit,
 * mirroring the generator's own formula (registerProcessor.ts's getActiveBusPortsFromDefinition):
 *   physicalPrefix + (portNameOverrides[logicalName] ?? logicalName.toLowerCase())
 *
 * Returns null when the interface cannot be reconstructed this way — a conduit/custom
 * interface (lookupBusDef returns an empty array) or a bus type lookupBusDef doesn't
 * recognize at all — so callers can fall back to a coarser, legacy-compatible check.
 */
export function reconstructBusPortNameSet(iface: ReconstructableBusInterface): Set<string> | null {
  const busDef = lookupBusDef(iface.type ?? '');
  if (!busDef || busDef.length === 0) {
    return null;
  }

  const prefix = (iface.physicalPrefix ?? '').toLowerCase();
  const overrides = iface.portNameOverrides ?? {};
  const optional = new Set((iface.useOptionalPorts ?? []).map((s) => s.toUpperCase()));
  const absent = new Set((iface.absentPorts ?? []).map((s) => s.toUpperCase()));

  const names = new Set<string>();
  for (const def of busDef) {
    if (def.role) {
      continue; // clock/reset roles never become bus-interface ports
    }
    const upper = def.name.toUpperCase();
    if (absent.has(upper)) {
      continue;
    }
    if (def.presence === 'optional' && !optional.has(upper)) {
      continue;
    }
    const suffix = overrides[def.name] ?? def.name.toLowerCase();
    names.add(`${prefix}${suffix}`.toLowerCase());
  }
  return names;
}
