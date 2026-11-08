/**
 * Pure inputs of the IP core symbol: the bus-library lookups `computeLayout` takes and the
 * clock-domain colors. Shared by the canvas (`IpBlockCanvas`) and the headless `ipcraft render`,
 * so both draw the same symbol. No React or DOM.
 */

import type { BusInterface, IpCore } from '../../../types/ipCore';
import type {
  BusInterface as DomainBusInterface,
  Parameter,
} from '../../../../domain/ipcore.types';
import {
  canonicalizeBusType,
  normalizeInterfaceMode,
  resolveBusInterface,
  type BusInterfaceResolution,
  type NormalizedBusLibrary,
} from '../../../../shared/busContracts';
import { lookupBusDef, type BusPortDef } from '../../utils/busLibrary';
import { computeLayout, type CanvasLayout } from './canvasLayout';

/** Distinct colours for clock domains when multiple clocks are defined */
export const CLOCK_DOMAIN_COLORS = [
  '#4ec9b0', // teal
  '#e5a96a', // amber-orange
  '#dcdcaa', // yellow
  '#c586c0', // purple
  '#9cdcfe', // sky blue
  '#f28b82', // coral
];

/** The colour of clock domain `idx`, or undefined for a single-clock core or no domain (-1). */
export function clockDomainColor(idx: number, multiDomain: boolean): string | undefined {
  if (!multiDomain || idx < 0) {
    return undefined;
  }
  return CLOCK_DOMAIN_COLORS[idx % CLOCK_DOMAIN_COLORS.length];
}

/** Whether the core has several clocks, so ports are coloured by domain. */
export function hasMultipleClockDomains(ipCore: IpCore): boolean {
  return (ipCore.clocks?.length ?? 0) > 1;
}

/** Port definitions of a bus type; unknown without a library. */
export function busPortLookup(
  library: NormalizedBusLibrary | undefined
): (type: string) => BusPortDef[] | null {
  if (!library) {
    return () => null;
  }
  return (type: string) => lookupBusDef(type, library);
}

/** Whether a bus bundle can be expanded into signals: it lists conduit ports or its type is defined. */
export function isExpandableBus(
  bus: { type?: string; conduitPorts?: unknown[] },
  busDefs: (type: string) => BusPortDef[] | null
): boolean {
  return Array.isArray(bus.conduitPorts) || busDefs(bus.type ?? '') !== null;
}

/** Whether a bus sits on the consuming (left) side, by its contract; undefined when unknown. */
export function contractConsumerLookup(
  library: NormalizedBusLibrary | undefined
): ((bus: BusInterface) => boolean | undefined) | undefined {
  if (!library) {
    return undefined;
  }
  return (bus) => {
    const match = canonicalizeBusType(bus.type, library);
    if (!match) {
      return undefined;
    }
    return normalizeInterfaceMode(match.contract, bus.mode) === match.contract.modePolicy.consumer;
  };
}

/** The contract display name of a bus type, for the protocol badge. */
export function protocolLabelLookup(
  library: NormalizedBusLibrary | undefined
): ((busType: string) => string | undefined) | undefined {
  if (!library) {
    return undefined;
  }
  return (busType) => canonicalizeBusType(busType, library)?.contract.displayName;
}

/** Resolves a bus interface against its contract and the core's parameters. */
export function busResolutionLookupFor(
  parameters: IpCore['parameters'],
  library: NormalizedBusLibrary | undefined
): ((bus: BusInterface, busIndex: number) => BusInterfaceResolution | null) | undefined {
  if (!library) {
    return undefined;
  }
  return (bus, busIndex) =>
    resolveBusInterface({
      busInterface: bus as unknown as DomainBusInterface,
      busIndex,
      parameters: (parameters ?? []) as unknown as Parameter[],
      library,
    });
}

/** The lookups and text `computeLayout` takes after the core and the expanded bus ids. */
export interface SymbolLayoutInputs {
  busDefs: (type: string) => BusPortDef[] | null;
  description: string | undefined;
  isContractConsumer: ((bus: BusInterface) => boolean | undefined) | undefined;
  protocolLabel: ((busType: string) => string | undefined) | undefined;
  busResolutionLookup:
    | ((bus: BusInterface, busIndex: number) => BusInterfaceResolution | null)
    | undefined;
}

/** The description as text: YAML may hold a number, and the layout wraps it as a string. */
export function symbolDescription(ipCore: IpCore): string | undefined {
  return ipCore.description === undefined || ipCore.description === null
    ? undefined
    : String(ipCore.description);
}

/**
 * The arguments of `computeLayout` after the core and the expanded bus ids, built from the core
 * and its bus library (`undefined` when none is loaded). Shared by the canvas and `ipcraft render`.
 */
export function symbolLayoutInputs(
  ipCore: IpCore,
  library: NormalizedBusLibrary | undefined
): SymbolLayoutInputs {
  return {
    busDefs: busPortLookup(library),
    description: symbolDescription(ipCore),
    isContractConsumer: contractConsumerLookup(library),
    protocolLabel: protocolLabelLookup(library),
    busResolutionLookup: busResolutionLookupFor(ipCore.parameters, library),
  };
}

/** The symbol layout of `ipCore` with the given bus bundles expanded (none by default). */
export function computeSymbolLayout(
  ipCore: IpCore,
  inputs: SymbolLayoutInputs,
  expandedBusIds: Set<string> = new Set()
): CanvasLayout {
  return computeLayout(
    ipCore,
    expandedBusIds,
    inputs.busDefs,
    inputs.description,
    inputs.isContractConsumer,
    inputs.protocolLabel,
    inputs.busResolutionLookup
  );
}
