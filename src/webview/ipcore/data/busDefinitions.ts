export interface BusPortDef {
  name: string;
  width?: number;
  direction?: 'in' | 'out';
  presence: 'required' | 'optional';
  /** Marks signals that map to a shared clock or reset — hidden when the bus has an association */
  role?: 'clock' | 'reset';
}

const AXI4_LITE: BusPortDef[] = [
  { name: 'ACLK', presence: 'required', role: 'clock' },
  { name: 'ARESETn', presence: 'required', role: 'reset' },
  { name: 'AWADDR', width: 32, direction: 'out', presence: 'required' },
  { name: 'AWVALID', direction: 'out', presence: 'required' },
  { name: 'AWREADY', direction: 'in', presence: 'required' },
  { name: 'AWPROT', width: 3, direction: 'out', presence: 'optional' },
  { name: 'WDATA', width: 32, direction: 'out', presence: 'required' },
  { name: 'WSTRB', width: 4, direction: 'out', presence: 'required' },
  { name: 'WVALID', direction: 'out', presence: 'required' },
  { name: 'WREADY', direction: 'in', presence: 'required' },
  { name: 'BRESP', width: 2, direction: 'in', presence: 'required' },
  { name: 'BVALID', direction: 'in', presence: 'required' },
  { name: 'BREADY', direction: 'out', presence: 'required' },
  { name: 'ARADDR', width: 32, direction: 'out', presence: 'required' },
  { name: 'ARVALID', direction: 'out', presence: 'required' },
  { name: 'ARREADY', direction: 'in', presence: 'required' },
  { name: 'ARPROT', width: 3, direction: 'out', presence: 'optional' },
  { name: 'RDATA', width: 32, direction: 'in', presence: 'required' },
  { name: 'RRESP', width: 2, direction: 'in', presence: 'required' },
  { name: 'RVALID', direction: 'in', presence: 'required' },
  { name: 'RREADY', direction: 'out', presence: 'required' },
];

const AXI4_FULL: BusPortDef[] = [
  { name: 'ACLK', presence: 'required', role: 'clock' },
  { name: 'ARESETn', presence: 'required', role: 'reset' },
  { name: 'AWADDR', width: 32, direction: 'out', presence: 'required' },
  { name: 'AWVALID', direction: 'out', presence: 'required' },
  { name: 'AWREADY', direction: 'in', presence: 'required' },
  { name: 'AWPROT', width: 3, direction: 'out', presence: 'optional' },
  { name: 'AWLEN', width: 8, direction: 'out', presence: 'optional' },
  { name: 'AWSIZE', width: 3, direction: 'out', presence: 'optional' },
  { name: 'AWBURST', width: 2, direction: 'out', presence: 'optional' },
  { name: 'AWLOCK', width: 1, direction: 'out', presence: 'optional' },
  { name: 'AWCACHE', width: 4, direction: 'out', presence: 'optional' },
  { name: 'WDATA', width: 32, direction: 'out', presence: 'required' },
  { name: 'WSTRB', width: 4, direction: 'out', presence: 'required' },
  { name: 'WVALID', direction: 'out', presence: 'required' },
  { name: 'WREADY', direction: 'in', presence: 'required' },
  { name: 'BRESP', width: 2, direction: 'in', presence: 'required' },
  { name: 'BVALID', direction: 'in', presence: 'required' },
  { name: 'BREADY', direction: 'out', presence: 'required' },
  { name: 'ARADDR', width: 32, direction: 'out', presence: 'required' },
  { name: 'ARVALID', direction: 'out', presence: 'required' },
  { name: 'ARREADY', direction: 'in', presence: 'required' },
  { name: 'ARPROT', width: 3, direction: 'out', presence: 'optional' },
  { name: 'ARLEN', width: 8, direction: 'out', presence: 'optional' },
  { name: 'ARSIZE', width: 3, direction: 'out', presence: 'optional' },
  { name: 'ARBURST', width: 2, direction: 'out', presence: 'optional' },
  { name: 'ARLOCK', width: 1, direction: 'out', presence: 'optional' },
  { name: 'ARCACHE', width: 4, direction: 'out', presence: 'optional' },
  { name: 'RDATA', width: 32, direction: 'in', presence: 'required' },
  { name: 'RRESP', width: 2, direction: 'in', presence: 'required' },
  { name: 'RVALID', direction: 'in', presence: 'required' },
  { name: 'RREADY', direction: 'out', presence: 'required' },
];

const AXI_STREAM: BusPortDef[] = [
  { name: 'ACLK', presence: 'required', role: 'clock' },
  { name: 'ARESETn', presence: 'required', role: 'reset' },
  { name: 'TDATA', width: 32, direction: 'out', presence: 'required' },
  { name: 'TVALID', direction: 'out', presence: 'required' },
  { name: 'TREADY', direction: 'in', presence: 'required' },
  { name: 'TSTRB', width: 4, direction: 'out', presence: 'optional' },
  { name: 'TKEEP', width: 4, direction: 'out', presence: 'optional' },
  { name: 'TLAST', direction: 'out', presence: 'optional' },
  { name: 'TID', width: 8, direction: 'out', presence: 'optional' },
  { name: 'TDEST', width: 4, direction: 'out', presence: 'optional' },
  { name: 'TUSER', width: 1, direction: 'out', presence: 'optional' },
];

const AVALON_MM: BusPortDef[] = [
  { name: 'clk', presence: 'required', role: 'clock' },
  { name: 'reset', presence: 'required', role: 'reset' },
  { name: 'address', width: 32, direction: 'out', presence: 'required' },
  { name: 'read', direction: 'out', presence: 'required' },
  { name: 'write', direction: 'out', presence: 'required' },
  { name: 'byteenable', width: 4, direction: 'out', presence: 'optional' },
  { name: 'chipselect', direction: 'out', presence: 'optional' },
  { name: 'writedata', width: 32, direction: 'out', presence: 'required' },
  { name: 'readdata', width: 32, direction: 'in', presence: 'required' },
  { name: 'readdatavalid', direction: 'in', presence: 'optional' },
  { name: 'waitrequest', direction: 'in', presence: 'optional' },
  { name: 'burstcount', width: 8, direction: 'out', presence: 'optional' },
  { name: 'beginbursttransfer', direction: 'out', presence: 'optional' },
  { name: 'response', width: 2, direction: 'in', presence: 'optional' },
];

const AVALON_ST: BusPortDef[] = [
  { name: 'clk', presence: 'required', role: 'clock' },
  { name: 'reset', presence: 'required', role: 'reset' },
  { name: 'data', width: 32, direction: 'out', presence: 'required' },
  { name: 'valid', direction: 'out', presence: 'required' },
  { name: 'ready', direction: 'in', presence: 'optional' },
  { name: 'startofpacket', direction: 'out', presence: 'optional' },
  { name: 'endofpacket', direction: 'out', presence: 'optional' },
  { name: 'empty', width: 2, direction: 'out', presence: 'optional' },
  { name: 'channel', width: 8, direction: 'out', presence: 'optional' },
  { name: 'error', width: 2, direction: 'out', presence: 'optional' },
];

/**
 * Resolves a bus type string (e.g. "ipcraft.busif.axi4_lite.1.0") to its port list.
 * Returns null if the bus type is unknown.
 */
export function lookupBusDef(busType: string): BusPortDef[] | null {
  const lower = busType.toLowerCase();
  if (lower.includes('axi4_lite') || lower.includes('axi4-lite') || lower.includes('axi4l')) {
    return AXI4_LITE;
  }
  if (lower.includes('axi4_full') || lower.includes('axi4-full')) {
    return AXI4_FULL;
  }
  if (
    lower.includes('axi_stream') ||
    lower.includes('axi-stream') ||
    lower.includes('axis') ||
    lower.includes('axi4s')
  ) {
    return AXI_STREAM;
  }
  if (
    lower.includes('avalon_mm') ||
    lower.includes('avalon-mm') ||
    lower.includes('avalon_memory')
  ) {
    return AVALON_MM;
  }
  if (
    lower.includes('avalon_st') ||
    lower.includes('avalon-st') ||
    lower.includes('avalon_stream')
  ) {
    return AVALON_ST;
  }
  // Full AXI4 (after ruling out lite/stream)
  if (lower.includes('axi4') && !lower.includes('lite') && !lower.includes('stream')) {
    return AXI4_FULL;
  }
  // Conduit / custom interface — signals are defined by conduitPorts on the bus entry
  if (lower.includes('conduit')) {
    return [];
  }
  return null;
}

/** Returns true if the bus type is a user-defined conduit (custom) interface. */
export function isConduitType(busType: string): boolean {
  return busType.toLowerCase().includes('conduit');
}
