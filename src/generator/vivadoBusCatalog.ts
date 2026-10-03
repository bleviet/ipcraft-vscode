import { normalizeBusType } from './registerProcessor';
import { BUS_VLNV } from '../shared/busVlnv';

// Vivado bus type mapping: IPCraft bus types to the Xilinx bus and abstraction
// definitions Vivado ships, with the logical ports each abstraction declares.

export interface VivadoBusTypeInfo {
  vendor: string;
  library: string;
  name: string;
  abstraction: string;
  protocol?: string;
  libraryKey: string;
  /**
   * Logical port names declared by the Xilinx abstraction. Vivado matches them
   * exactly (IP_Flow 19-4729) and rejects any name it does not declare
   * (IP_Flow 19-568), so IPCraft library names are uppercased and filtered
   * against this set.
   */
  logicalPorts: ReadonlySet<string>;
}

// From Vivado's data/ip/interfaces/<name>_v1_0/<name>_rtl.xml.
export const AXIMM_RTL_PORTS: ReadonlySet<string> = new Set(
  (
    'AWID AWADDR AWLEN AWSIZE AWBURST AWLOCK AWCACHE AWPROT AWREGION AWQOS AWUSER AWVALID ' +
    'AWREADY WID WDATA WSTRB WLAST WUSER WVALID WREADY BID BRESP BUSER BVALID BREADY ARID ' +
    'ARADDR ARLEN ARSIZE ARBURST ARLOCK ARCACHE ARPROT ARREGION ARQOS ARUSER ARVALID ARREADY ' +
    'RID RDATA RRESP RLAST RUSER RVALID RREADY'
  ).split(' ')
);
export const AXIS_RTL_PORTS: ReadonlySet<string> = new Set(
  'TID TDEST TDATA TSTRB TKEEP TLAST TUSER TVALID TREADY'.split(' ')
);
// avalon_rtl has no active-low (*_n) variants and no DEBUGACCESS.
export const AVALON_RTL_PORTS: ReadonlySet<string> = new Set(
  (
    'ADDRESS READDATA READDATAVALID WAITREQUEST BYTEENABLE READ RESPONSE WRITE WRITEDATA ' +
    'LOCK WRITERESPONSEVALID BURSTCOUNT BEGINBURSTTRANSFER'
  ).split(' ')
);

export const IPCRAFT_TO_VIVADO: Record<string, VivadoBusTypeInfo> = {
  [BUS_VLNV.AXI4_LITE]: {
    vendor: 'xilinx.com',
    library: 'interface',
    name: 'aximm',
    abstraction: 'aximm_rtl',
    protocol: 'AXI4LITE',
    libraryKey: 'AXI4_LITE',
    logicalPorts: AXIMM_RTL_PORTS,
  },
  [BUS_VLNV.AXI4_FULL]: {
    vendor: 'xilinx.com',
    library: 'interface',
    name: 'aximm',
    abstraction: 'aximm_rtl',
    protocol: 'AXI4',
    libraryKey: 'AXI4_FULL',
    logicalPorts: AXIMM_RTL_PORTS,
  },
  [BUS_VLNV.AXI_STREAM]: {
    vendor: 'xilinx.com',
    library: 'interface',
    name: 'axis',
    abstraction: 'axis_rtl',
    libraryKey: 'AXI_STREAM',
    logicalPorts: AXIS_RTL_PORTS,
  },
  [BUS_VLNV.AVALON_MM]: {
    vendor: 'xilinx.com',
    library: 'interface',
    name: 'avalon',
    abstraction: 'avalon_rtl',
    libraryKey: 'AVALON_MEMORY_MAPPED',
    logicalPorts: AVALON_RTL_PORTS,
  },
};

/**
 * Resolves an interface type string (short alias, VLNV, or full VLNV) to a
 * VivadoBusTypeInfo entry. Falls back to normalizeBusType() alias resolution so
 * that short tokens produced by the parser (e.g. 'AXI4L', 'AXI4F', 'AXI4S')
 * map correctly even if not listed as explicit keys in IPCRAFT_TO_VIVADO.
 */
export function resolveVivadoBusType(ifaceType: string): VivadoBusTypeInfo | undefined {
  const direct = IPCRAFT_TO_VIVADO[ifaceType];
  if (direct) {
    return direct;
  }
  const { libraryKey } = normalizeBusType(ifaceType);
  if (!libraryKey) {
    return undefined;
  }
  return Object.values(IPCRAFT_TO_VIVADO).find((v) => v.libraryKey === libraryKey);
}
