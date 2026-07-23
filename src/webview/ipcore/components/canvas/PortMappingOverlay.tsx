import React from 'react';
import type { IpCore } from '../../../types/ipCore';
import { GroupingMappingStep } from './GroupingMappingStep';
import type { GroupAsStandardOptions } from '../../hooks/useGroupPorts';
import type { BusPortDef } from '../../data/busDefinitions';

export interface PendingPortDrop {
  portIndex: number;
  busIndex: number;
}

interface PortMappingOverlayProps {
  ipCore: IpCore;
  pendingPortDrop: PendingPortDrop;
  busDefs: (type: string) => BusPortDef[] | null;
  onConfirm: (opts: GroupAsStandardOptions, busIndex: number) => void;
  onCancel: () => void;
}

/**
 * Standard-protocol port-to-bus mapping flow: reuses `GroupingMappingStep`
 * to let the user pick signal assignments when a port is dropped onto a bus
 * interface that isn't a conduit/custom type.
 */
export const PortMappingOverlay: React.FC<PortMappingOverlayProps> = ({
  ipCore,
  pendingPortDrop,
  busDefs,
  onConfirm,
  onCancel,
}) => {
  const pendingBus = ipCore.busInterfaces?.[pendingPortDrop.busIndex];
  if (!pendingBus) {
    return null;
  }
  const busType = (pendingBus as { type?: string }).type ?? '';
  const busLabel = (pendingBus as { name?: string }).name ?? busType;
  const existingPrefix = (pendingBus as { physicalPrefix?: string }).physicalPrefix;
  const existingMode =
    (pendingBus as { mode?: string }).mode === 'master' ||
    (pendingBus as { mode?: string }).mode === 'source'
      ? ('master' as const)
      : ('slave' as const);

  // Reconstruct signal → physicalName for every signal the bus already owns,
  // so GroupingMappingStep can show those rows as locked (read-only).
  const rawSignals = busDefs(busType) ?? [];
  const existingNameOverrides =
    (pendingBus as { portNameOverrides?: Record<string, string> }).portNameOverrides ?? {};
  const useOptional = new Set(
    ((pendingBus as { useOptionalPorts?: string[] }).useOptionalPorts ?? []).map((s) =>
      s.toUpperCase()
    )
  );
  const existingPortAssignments: Record<string, string> = {};
  for (const sig of rawSignals) {
    if (sig.role) {
      continue;
    }
    if (sig.presence === 'optional' && !useOptional.has(sig.name.toUpperCase())) {
      continue;
    }
    const suffix = existingNameOverrides[sig.name] ?? sig.name.toLowerCase();
    existingPortAssignments[sig.name] = `${existingPrefix ?? ''}${suffix}`;
  }

  return (
    <GroupingMappingStep
      ipCore={ipCore}
      busType={busType}
      busLabel={busLabel}
      selectedPortIndices={[pendingPortDrop.portIndex]}
      initialPrefix={existingPrefix}
      initialMode={existingMode}
      existingPortAssignments={existingPortAssignments}
      onConfirm={(opts) => onConfirm(opts, pendingPortDrop.busIndex)}
      onCancel={onCancel}
    />
  );
};
