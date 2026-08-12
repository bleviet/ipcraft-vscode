import {
  canonicalizeBusType,
  normalizeInterfaceMode,
  type NormalizedBusLibrary,
} from './busContracts';

/**
 * Canonical IPCraft VLNV bus-type identifiers — single source of truth.
 *
 * Every parser, generator, and webview component that needs a bus type string
 * must import from here instead of writing the string inline. This prevents
 * typos, ensures all layers stay in sync, and gives TypeScript compile-time
 * coverage: if a key is renamed or a new bus type is added, every reference
 * becomes a type error until updated.
 *
 * VLNV format: vendor:library:name:version
 *   vendor  = ipcraft
 *   library = busif
 *   name    = <bus name>
 *   version = 1.0
 */
export const BUS_VLNV = {
  AXI4_LITE: 'ipcraft:busif:axi4_lite:1.0',
  AXI4_FULL: 'ipcraft:busif:axi4_full:1.0',
  AXI_STREAM: 'ipcraft:busif:axi_stream:1.0',
  AVALON_MM: 'ipcraft:busif:avalon_mm:1.0',
  AVALON_ST: 'ipcraft:busif:avalon_st:1.0',
  CONDUIT: 'ipcraft:busif:conduit:1.0',
} as const;

/** Union of every canonical IPCraft bus VLNV string. */
export type BusVlnv = (typeof BUS_VLNV)[keyof typeof BUS_VLNV];

/**
 * Returns true if a bus type + mode combination may reference a memory map.
 * Eligibility is declared by the resolved contract: the interface must be
 * memory-mapped and use the contract's consumer mode.
 */
export function busSupportsMemoryMap(
  busType: string,
  mode: string,
  library: NormalizedBusLibrary
): boolean {
  const match = canonicalizeBusType(busType, library);
  return (
    match !== null &&
    match.contract.interfaceKind === 'memoryMapped' &&
    normalizeInterfaceMode(match.contract, mode) === match.contract.modePolicy.consumer
  );
}

/** Returns true when one interrupt can unambiguously reference this interface as
 * a Platform Designer addressable point. Multi-instance arrays expand to several
 * addressable points, so their unexpanded logical name is not eligible. */
export function busSupportsInterruptAssociation(
  bus: {
    type: string;
    mode: string;
    array?: { count?: number } | null;
  },
  library: NormalizedBusLibrary
): boolean {
  return (
    busSupportsMemoryMap(bus.type, bus.mode, library) &&
    (bus.array?.count === undefined || bus.array.count <= 1)
  );
}
