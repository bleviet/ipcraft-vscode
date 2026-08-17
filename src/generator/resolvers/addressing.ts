import type { ContextResolver, ResolverInput } from './types';
import { resolveBusInterface } from '../../shared/busContracts';
import type { BusInterface, Parameter } from '../../domain/ipcore.types';

/** Derive data_width from the primary memory-mapped slave's WDATA port in the bus library. */
function deriveDataWidth(input: ResolverInput): number {
  const { ipCore, busLibrary } = input;
  for (const [busIndex, bus] of (ipCore.busInterfaces ?? []).entries()) {
    const resolution = resolveBusInterface({
      busInterface: bus as unknown as BusInterface,
      busIndex,
      parameters: (ipCore.parameters ?? []) as unknown as Parameter[],
      library: busLibrary,
    });
    const contract = resolution.match?.contract;
    if (
      contract?.interfaceKind !== 'memoryMapped' ||
      resolution.normalizedMode !== contract.modePolicy.consumer
    ) {
      continue;
    }
    const wdata = contract.ports.find(
      (p) => typeof p.name === 'string' && /^(WDATA|writedata)$/.test(p.name)
    );
    const width = wdata ? resolution.portWidths[wdata.name]?.value : undefined;
    if (typeof width === 'number' && Number.isFinite(width) && width > 0) {
      return width;
    }
    break;
  }
  return 32;
}

export const addressingResolver: ContextResolver = {
  name: 'addressing',

  resolve(input: ResolverInput): Record<string, unknown> {
    const { ipCore, registers } = input;
    const dataWidth = deriveDataWidth(input);
    const regWidth = dataWidth / 8;

    const lastReg = registers.length > 0 ? registers[registers.length - 1] : null;
    const lastOffsetEnd = lastReg ? ((lastReg.offset as number) ?? 0) + regWidth : regWidth;
    const maxByteAddress = Math.max(lastOffsetEnd, registers.length * regWidth);
    const computedAddrWidth = Math.max(3, Math.ceil(Math.log2(Math.max(maxByteAddress, 2))));
    const rawAddrWidth = (ipCore as Record<string, unknown>).addrWidth;
    const addrWidth = typeof rawAddrWidth === 'number' ? rawAddrWidth : computedAddrWidth;

    return {
      data_width: dataWidth,
      reg_width: regWidth,
      addr_width: addrWidth,
      addr_map_size: lastOffsetEnd,
    };
  },
};
