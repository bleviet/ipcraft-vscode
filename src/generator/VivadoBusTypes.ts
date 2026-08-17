import { BUS_REGISTRY } from './buses/builtin';
import { BUS_VLNV } from '../shared/busVlnv';
import { canonicalizeBusType, type NormalizedBusLibrary } from '../shared/busContracts';

export interface VivadoBusTypeInfo {
  vendor: string;
  library: string;
  name: string;
  abstraction: string;
  protocol?: string;
  libraryKey: string;
}

const IPCRAFT_TO_VIVADO: Record<string, VivadoBusTypeInfo> = {
  [BUS_VLNV.AXI4_LITE]: {
    vendor: 'xilinx.com',
    library: 'interface',
    name: 'aximm',
    abstraction: 'aximm_rtl',
    protocol: 'AXI4LITE',
    libraryKey: 'AXI4_LITE',
  },
  [BUS_VLNV.AXI4_FULL]: {
    vendor: 'xilinx.com',
    library: 'interface',
    name: 'aximm',
    abstraction: 'aximm_rtl',
    protocol: 'AXI4',
    libraryKey: 'AXI4_FULL',
  },
  [BUS_VLNV.AXI_STREAM]: {
    vendor: 'xilinx.com',
    library: 'interface',
    name: 'axis',
    abstraction: 'axis_rtl',
    libraryKey: 'AXI_STREAM',
  },
  [BUS_VLNV.AVALON_MM]: {
    vendor: 'xilinx.com',
    library: 'interface',
    name: 'avalon',
    abstraction: 'avalon_rtl',
    libraryKey: 'AVALON_MEMORY_MAPPED',
  },
};

/** Resolve an IPCraft alias or canonical VLNV to Vivado's native bus metadata. */
export function resolveVivadoBusType(
  ifaceType: string,
  busLibrary: NormalizedBusLibrary
): VivadoBusTypeInfo | undefined {
  const canonical = canonicalizeBusType(ifaceType, busLibrary)?.canonicalVlnv ?? ifaceType;
  const direct = IPCRAFT_TO_VIVADO[canonical];
  if (direct) {
    return direct;
  }
  const { libraryKey } = BUS_REGISTRY.normalize(ifaceType, busLibrary);
  if (!libraryKey) {
    return undefined;
  }
  return Object.values(IPCRAFT_TO_VIVADO).find((entry) => entry.libraryKey === libraryKey);
}
