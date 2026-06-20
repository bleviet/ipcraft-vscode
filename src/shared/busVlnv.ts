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
 * Only single (non-array), slave-mode, memory-mapped protocols qualify:
 * AXI4-Lite, AXI4-Full, and Avalon-MM. Streaming protocols are rejected first
 * so a bare "avalon" token (e.g. the generator-emitted
 * "xilinx.com:interface:avalon:1.0") cannot match Avalon-ST.
 */
export function busSupportsMemoryMap(busType: string, mode: string): boolean {
  if (mode !== 'slave') {
    return false;
  }
  const lower = busType.toLowerCase();
  if (
    lower.includes('stream') ||
    lower.includes('axi4s') ||
    lower.includes('avalon_st') ||
    lower.includes('avalon-st')
  ) {
    return false;
  }
  return lower.includes('axi4') || lower.includes('avalon');
}
