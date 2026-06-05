import { useCallback } from 'react';
import type { IpCore, BusInterface, ConduitPort, Port } from '../../types/ipCore';
import { lookupBusDef, isConduitType } from '../data/busDefinitions';
import type { BusPortDef } from '../data/busDefinitions';

export type BatchUpdate = (mutations: Array<[Array<string | number>, unknown]>) => void;

export interface GroupAsStandardOptions {
  portIndices: number[];
  busType: string;
  mode: 'slave' | 'master';
  physicalPrefix: string;
  interfaceName: string;
  portNameOverrides?: Record<string, string>;
  useOptionalPorts?: string[];
  associatedClock?: string | null;
  associatedReset?: string | null;
}

export interface GroupAsConduitOptions {
  portIndices: number[];
  interfaceName: string;
  physicalPrefix: string;
}

export function useGroupPorts(ipCore: IpCore, batchUpdate: BatchUpdate) {
  const groupAsStandard = useCallback(
    (opts: GroupAsStandardOptions) => {
      const ports: Port[] = [...(ipCore.ports ?? [])];
      const indexSet = new Set(opts.portIndices);

      const filteredPorts = ports.filter((_, i) => !indexSet.has(i));

      const newBus: BusInterface & { portNameOverrides?: Record<string, string> } = {
        name: opts.interfaceName,
        type: opts.busType,
        mode: opts.mode,
        physicalPrefix: opts.physicalPrefix,
      };

      if (opts.associatedClock) {
        newBus.associatedClock = opts.associatedClock;
      }
      if (opts.associatedReset) {
        newBus.associatedReset = opts.associatedReset;
      }
      if (opts.portNameOverrides && Object.keys(opts.portNameOverrides).length > 0) {
        newBus.portNameOverrides = opts.portNameOverrides;
      }
      if (opts.useOptionalPorts && opts.useOptionalPorts.length > 0) {
        newBus.useOptionalPorts = opts.useOptionalPorts;
      }

      const existingBuses: BusInterface[] = [...(ipCore.busInterfaces ?? [])];

      batchUpdate([
        [['ports'], filteredPorts],
        [['busInterfaces'], [...existingBuses, newBus]],
      ]);
    },
    [ipCore, batchUpdate]
  );

  const groupAsConduit = useCallback(
    (opts: GroupAsConduitOptions) => {
      const ports: Port[] = [...(ipCore.ports ?? [])];
      const indexSet = new Set(opts.portIndices);

      const selectedPorts = ports.filter((_, i) => indexSet.has(i));
      const filteredPorts = ports.filter((_, i) => !indexSet.has(i));

      const conduitPorts: ConduitPort[] = selectedPorts.map((p) => ({
        name: p.name,
        direction: p.direction,
        ...(p.width !== undefined ? { width: p.width } : {}),
      }));

      const newBus: BusInterface = {
        name: opts.interfaceName,
        type: 'ipcraft.busif.conduit.1.0',
        mode: 'conduit',
        physicalPrefix: opts.physicalPrefix,
        conduitPorts,
      };

      const existingBuses: BusInterface[] = [...(ipCore.busInterfaces ?? [])];

      batchUpdate([
        [['ports'], filteredPorts],
        [['busInterfaces'], [...existingBuses, newBus]],
      ]);
    },
    [ipCore, batchUpdate]
  );

  const addPortToConduit = useCallback(
    (portIndex: number, busIndex: number) => {
      const ports: Port[] = [...(ipCore.ports ?? [])];
      const buses: BusInterface[] = [...(ipCore.busInterfaces ?? [])];
      const port = ports[portIndex];
      const bus = buses[busIndex];

      if (!port || !bus) {
        return;
      }

      const newConduitPort: ConduitPort = {
        name: port.name,
        direction: port.direction,
        ...(port.width !== undefined ? { width: port.width } : {}),
      };

      const updatedBus: BusInterface = {
        ...bus,
        conduitPorts: [...(bus.conduitPorts ?? []), newConduitPort],
      };

      const filteredPorts = ports.filter((_, i) => i !== portIndex);
      const updatedBuses = buses.map((b, i) => (i === busIndex ? updatedBus : b));

      batchUpdate([
        [['ports'], filteredPorts],
        [['busInterfaces'], updatedBuses],
      ]);
    },
    [ipCore, batchUpdate]
  );

  /**
   * Ungroup a bus interface: dissolve the grouping and restore all signals
   * as individual entries in `ports[]`, then remove the bus interface.
   *
   * Conduit interface: each conduitPort becomes a Port verbatim.
   *
   * Standard protocol interface: reconstruct ports from the protocol's signal
   * definitions × physicalPrefix, applying any portNameOverrides and
   * portWidthOverrides. Directions are adjusted for the interface mode.
   * Clock/reset-role signals are skipped (they already live in clocks[]/resets[]).
   */
  const ungroupBusInterface = useCallback(
    (busIndex: number) => {
      const buses: BusInterface[] = [...(ipCore.busInterfaces ?? [])];
      const bus = buses[busIndex];
      if (!bus) {
        return;
      }

      const existingPorts: Port[] = [...(ipCore.ports ?? [])];
      const restoredPorts: Port[] = [];

      if (isConduitType(bus.type) || bus.mode === 'conduit' || bus.conduitPorts?.length) {
        // ── Conduit: restore conduitPorts as individual ports ──
        const conduitPorts = bus.conduitPorts ?? [];
        for (const cp of conduitPorts) {
          restoredPorts.push({
            name: cp.name,
            direction: (cp.direction ?? 'inout') as Port['direction'],
            ...(cp.width !== undefined ? { width: cp.width } : {}),
          });
        }
      } else {
        // ── Standard protocol: reconstruct ports from signal definitions ──
        const signalDefs: BusPortDef[] | null = lookupBusDef(bus.type);
        if (signalDefs) {
          const prefix = bus.physicalPrefix ?? '';
          const widthOverrides =
            (bus as BusInterface & { portWidthOverrides?: Record<string, number | string> })
              .portWidthOverrides ?? {};
          const nameOverrides =
            (bus as BusInterface & { portNameOverrides?: Record<string, string> })
              .portNameOverrides ?? {};
          const useOptional = new Set((bus.useOptionalPorts ?? []).map((s) => s.toUpperCase()));
          const isMaster = bus.mode === 'master' || bus.mode === 'source';

          for (const def of signalDefs) {
            // Skip clock/reset-role signals — they live in their own arrays
            if (def.role) {
              continue;
            }
            // Skip optional signals that were not explicitly activated
            if (def.presence === 'optional' && !useOptional.has(def.name.toUpperCase())) {
              continue;
            }

            // Physical port name: prefix + (override suffix OR logical_name.lowercase)
            const suffix = nameOverrides[def.name] ?? def.name.toLowerCase();
            const portName = `${prefix}${suffix}`;

            // Direction: def.direction is from master perspective; flip for slave
            let dir: Port['direction'] = 'inout';
            if (def.direction) {
              if (isMaster) {
                dir = def.direction;
              } else {
                dir = def.direction === 'in' ? 'out' : 'in';
              }
            }

            // Width: override > protocol default > 1
            const width: number | string = widthOverrides[def.name] ?? def.width ?? 1;

            restoredPorts.push({ name: portName, direction: dir, width });
          }
        }
      }

      // Avoid name collisions with already-existing ports
      const existingNames = new Set(existingPorts.map((p) => p.name));
      const deduped = restoredPorts.map((p) => {
        if (!existingNames.has(p.name)) {
          existingNames.add(p.name);
          return p;
        }
        // Suffix with _restored to avoid collision
        let candidate = `${p.name}_restored`;
        let n = 1;
        while (existingNames.has(candidate)) {
          candidate = `${p.name}_restored_${n++}`;
        }
        existingNames.add(candidate);
        return { ...p, name: candidate };
      });

      const updatedPorts = [...existingPorts, ...deduped];
      const updatedBuses = buses.filter((_, i) => i !== busIndex);

      batchUpdate([
        [['ports'], updatedPorts],
        [['busInterfaces'], updatedBuses.length > 0 ? updatedBuses : undefined],
      ]);
    },
    [ipCore, batchUpdate]
  );

  /** Remove a port from `ports[]` without touching any bus interface.
   *  Used when a port is dragged onto a standard-protocol bus — the port's
   *  physical name already matches the bus prefix so it is implicitly covered;
   *  we just de-duplicate the standalone entry. */
  const removeStandalonePort = useCallback(
    (portIndex: number) => {
      const ports: Port[] = [...(ipCore.ports ?? [])];
      const filteredPorts = ports.filter((_, i) => i !== portIndex);
      batchUpdate([[['ports'], filteredPorts]]);
    },
    [ipCore, batchUpdate]
  );

  return {
    groupAsStandard,
    groupAsConduit,
    addPortToConduit,
    ungroupBusInterface,
    removeStandalonePort,
  };
}
