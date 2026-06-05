import { useCallback } from 'react';
import type { IpCore, BusInterface, ConduitPort, Port } from '../../types/ipCore';

export type BatchUpdate = (mutations: Array<[Array<string | number>, unknown]>) => void;

export interface GroupAsStandardOptions {
  portIndices: number[];
  busType: string;
  mode: 'slave' | 'master';
  physicalPrefix: string;
  interfaceName: string;
  portNameOverrides?: Record<string, string>;
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

  return { groupAsStandard, groupAsConduit, addPortToConduit };
}
