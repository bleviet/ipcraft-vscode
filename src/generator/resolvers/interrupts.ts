import type { BusRuleRegistry } from '../buses/registry';
import { expandBusInterfaces, normalizeBusType } from '../registerProcessor';
import type { BusInterfaceDef, IpCoreData } from '../types';

export interface InterruptPortContext {
  name: string;
  direction: string;
  sensitivity: string;
  associated_bus_interface: string;
  associated_clock: string;
}

function isMemoryMappedSlave(iface: BusInterfaceDef, registry: BusRuleRegistry): boolean {
  return (
    (iface.mode ?? '').toLowerCase() === 'slave' &&
    registry.isMemoryMapped(normalizeBusType(String(iface.type ?? '')).templateType)
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
  registry: BusRuleRegistry,
  expandedBusInterfaces: BusInterfaceDef[],
  primaryMemoryMappedIndex: number
): InterruptPortContext[] {
  const primaryClock = ipCore.clocks?.[0]?.name ?? 'clk';
  const primaryBus =
    primaryMemoryMappedIndex >= 0 ? expandedBusInterfaces[primaryMemoryMappedIndex] : undefined;

  return (ipCore.interrupts ?? []).map((interrupt) => {
    const interruptName = String(interrupt.name ?? '');
    const explicitBusName = interrupt.associatedBusInterface?.trim() ?? '';
    let associatedBus = primaryBus;

    if (explicitBusName) {
      const configuredBus = (ipCore.busInterfaces ?? []).find(
        (iface) => iface.name === explicitBusName
      );
      const isArray = (configuredBus?.array?.count ?? 0) > 1;
      if (!configuredBus || isArray || !isMemoryMappedSlave(configuredBus, registry)) {
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
