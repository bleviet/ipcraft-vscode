import { expandBusInterfaces } from '../registerProcessor';
import type { BusInterfaceDef, IpCoreData } from '../types';
import { busSupportsInterruptAssociation } from '../../shared/busVlnv';
import type { NormalizedBusLibrary } from '../../shared/busContracts';

export interface InterruptPortContext {
  name: string;
  direction: string;
  sensitivity: string;
  associated_bus_interface: string;
  associated_clock: string;
}

function isMemoryMappedConsumer(iface: BusInterfaceDef, library: NormalizedBusLibrary): boolean {
  return busSupportsInterruptAssociation(
    {
      type: String(iface.type ?? ''),
      mode: String(iface.mode ?? ''),
      array: iface.array,
    },
    library
  );
}

function requireKnownClock(ipCore: IpCoreData, clockName: string, source: string): string {
  const exists = (ipCore.clocks ?? []).some((clock) => clock.name === clockName);
  if (!exists) {
    throw new Error(`${source} references unknown clock '${clockName}'`);
  }
  return clockName;
}

export function buildInterruptPorts(
  ipCore: IpCoreData,
  library: NormalizedBusLibrary,
  expandedBusInterfaces: BusInterfaceDef[],
  primaryMemoryMappedIndex: number
): InterruptPortContext[] {
  const primaryClock = ipCore.clocks?.[0]?.name ?? 'clk';
  const primaryBus =
    primaryMemoryMappedIndex >= 0 ? expandedBusInterfaces[primaryMemoryMappedIndex] : undefined;

  return (ipCore.interrupts ?? []).map((interrupt) => {
    const interruptName = String(interrupt.name ?? '');
    const hasExplicitBusAssociation = typeof interrupt.associatedBusInterface === 'string';
    const explicitBusName = interrupt.associatedBusInterface?.trim() ?? '';
    let associatedBus = hasExplicitBusAssociation ? undefined : primaryBus;

    if (explicitBusName) {
      const configuredBus = (ipCore.busInterfaces ?? []).find(
        (iface) => iface.name === explicitBusName
      );
      const isArray = (configuredBus?.array?.count ?? 0) > 1;
      if (!configuredBus || isArray || !isMemoryMappedConsumer(configuredBus, library)) {
        throw new Error(
          `Interrupt '${interruptName}' references missing or ineligible memory-mapped slave interface '${explicitBusName}'`
        );
      }
      associatedBus = configuredBus.array
        ? expandBusInterfaces({
            busInterfaces: [configuredBus],
          })[0]
        : configuredBus;
    }

    const explicitClock = interrupt.associatedClock?.trim() ?? '';
    const busClock = associatedBus?.associatedClock?.trim() ?? '';
    const associatedClock = explicitClock
      ? requireKnownClock(ipCore, explicitClock, `Interrupt '${interruptName}'`)
      : busClock
        ? requireKnownClock(
            ipCore,
            busClock,
            `Bus interface '${String(associatedBus?.name ?? '')}'`
          )
        : primaryClock;

    return {
      name: interruptName,
      direction: String(interrupt.direction ?? 'out').toLowerCase(),
      sensitivity: String(interrupt.sensitivity ?? 'LEVEL_HIGH'),
      associated_bus_interface: String(associatedBus?.name ?? ''),
      associated_clock: associatedClock,
    };
  });
}
