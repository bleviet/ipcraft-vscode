import { useCallback } from 'react';
import type { IpCore, BusInterface, ConduitPort, Port } from '../../types/ipCore';
import { lookupBusDef, isConduitType } from '../data/busDefinitions';
import type { BusPortDef } from '../data/busDefinitions';
import { BUS_VLNV } from '../../../shared/busVlnv';

export type BatchUpdate = (mutations: Array<[Array<string | number>, unknown]>) => void;

export interface MapConduitToBusOptions {
  mode: 'slave' | 'master';
  portNameOverrides: Record<string, string>;
  portWidthOverrides?: Record<string, number | string>;
  useOptionalPorts: string[];
}

/**
 * Converts an already-authored conduit interface (free-form conduitPorts) into a
 * known-bus-type interface once its type resolves to a library definition (built-in,
 * saved custom, or discovered via the Vivado interface catalog scan): sets mode and
 * portNameOverrides/useOptionalPorts from the user's signal mapping, and clears
 * conduitPorts since the library definition is now the source of truth for ports.
 * Returns the updated busInterfaces array (does not mutate ipCore).
 */
export function applyMapConduitToKnownBus(
  ipCore: IpCore,
  busIndex: number,
  opts: MapConduitToBusOptions
): BusInterface[] {
  const buses = [...(ipCore.busInterfaces ?? [])] as Array<
    BusInterface & {
      portNameOverrides?: Record<string, string>;
      portWidthOverrides?: Record<string, number | string>;
      useOptionalPorts?: string[];
    }
  >;
  const current = buses[busIndex];
  if (!current) {
    return buses;
  }

  const updated: (typeof buses)[number] = {
    ...current,
    mode: opts.mode,
    conduitPorts: null,
  };
  if (Object.keys(opts.portNameOverrides).length > 0) {
    updated.portNameOverrides = opts.portNameOverrides;
  }
  if (opts.portWidthOverrides && Object.keys(opts.portWidthOverrides).length > 0) {
    updated.portWidthOverrides = opts.portWidthOverrides;
  }
  if (opts.useOptionalPorts.length > 0) {
    updated.useOptionalPorts = opts.useOptionalPorts;
  }
  buses[busIndex] = updated;
  return buses;
}

export interface GroupAsStandardOptions {
  portIndices: number[];
  busType: string;
  mode: 'slave' | 'master';
  physicalPrefix: string;
  interfaceName: string;
  portNameOverrides?: Record<string, string>;
  portWidthOverrides?: Record<string, number | string>;
  useOptionalPorts?: string[];
  associatedClock?: string | null;
  associatedReset?: string | null;
}

export interface GroupAsConduitOptions {
  portIndices: number[];
  interfaceName: string;
  physicalPrefix: string;
}

export function useGroupPorts(
  ipCore: IpCore,
  batchUpdate: BatchUpdate,
  busDefs?: (type: string) => BusPortDef[] | null
) {
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
      if (opts.portWidthOverrides && Object.keys(opts.portWidthOverrides).length > 0) {
        newBus.portWidthOverrides = opts.portWidthOverrides;
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
        type: BUS_VLNV.CONDUIT,
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
        const signalDefs: BusPortDef[] | null = (busDefs ?? lookupBusDef)(bus.type);
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

  /**
   * Merge a set of port assignments (produced by GroupingMappingStep) into an
   * existing standard-protocol bus interface instead of creating a new one.
   * Removes the assigned ports from `ports[]` and merges portName/widthOverrides
   * into the existing bus entry.
   */
  const mergePortsIntoStandardBus = useCallback(
    (opts: GroupAsStandardOptions, busIndex: number) => {
      const ports: Port[] = [...(ipCore.ports ?? [])];
      const buses: BusInterface[] = [...(ipCore.busInterfaces ?? [])];
      const bus = buses[busIndex];

      if (!bus) {
        return;
      }

      const indexSet = new Set(opts.portIndices);
      const filteredPorts = ports.filter((_, i) => !indexSet.has(i));

      type BusWithOverrides = BusInterface & {
        portNameOverrides?: Record<string, string>;
        portWidthOverrides?: Record<string, number | string>;
        useOptionalPorts?: string[];
      };

      const existing = bus as BusWithOverrides;
      const updatedBus: BusWithOverrides = {
        ...existing,
        portNameOverrides: opts.portNameOverrides
          ? { ...(existing.portNameOverrides ?? {}), ...opts.portNameOverrides }
          : existing.portNameOverrides,
        portWidthOverrides: opts.portWidthOverrides
          ? { ...(existing.portWidthOverrides ?? {}), ...opts.portWidthOverrides }
          : existing.portWidthOverrides,
        useOptionalPorts:
          opts.useOptionalPorts && opts.useOptionalPorts.length > 0
            ? [...new Set([...(existing.useOptionalPorts ?? []), ...opts.useOptionalPorts])]
            : existing.useOptionalPorts,
      };

      const updatedBuses = buses.map((b, i) => (i === busIndex ? updatedBus : b));

      batchUpdate([
        [['ports'], filteredPorts],
        [['busInterfaces'], updatedBuses],
      ]);
    },
    [ipCore, batchUpdate]
  );

  /**
   * Assign a standalone port to a named signal in a standard-protocol bus interface.
   *
   * Stores a portNameOverride so the bus explicitly tracks which physical port covers
   * `signalName`. The stored suffix is the part after the bus physicalPrefix (or the
   * full port name when no common prefix exists). The port is then removed from `ports[]`.
   */
  const addPortToStandardBus = useCallback(
    (portIndex: number, busIndex: number, signalName: string) => {
      const ports: Port[] = [...(ipCore.ports ?? [])];
      const buses: BusInterface[] = [...(ipCore.busInterfaces ?? [])];
      const port = ports[portIndex];
      const bus = buses[busIndex];

      if (!port || !bus || !signalName) {
        return;
      }

      const prefix = (bus as BusInterface & { physicalPrefix?: string }).physicalPrefix ?? '';
      const suffix =
        prefix.length > 0 && port.name.startsWith(prefix)
          ? port.name.slice(prefix.length)
          : port.name;

      const existingOverrides =
        (bus as BusInterface & { portNameOverrides?: Record<string, string> }).portNameOverrides ??
        {};

      const updatedBus: BusInterface & { portNameOverrides?: Record<string, string> } = {
        ...bus,
        portNameOverrides: { ...existingOverrides, [signalName]: suffix },
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

  /** Remove a port from `ports[]` without touching any bus interface. */
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
    addPortToStandardBus,
    mergePortsIntoStandardBus,
    ungroupBusInterface,
    removeStandalonePort,
  };
}
