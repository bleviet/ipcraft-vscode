import type { ContextResolver, ResolverInput } from './types';

function getString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object' && 'value' in value) {
    return String((value as Record<string, unknown>).value);
  }
  return String(value);
}

/** Derive data_width from the primary memory-mapped slave's WDATA port in the bus library. */
function deriveDataWidth(input: ResolverInput): number {
  const { ipCore, busDefinitions, registry } = input;
  for (const bus of ipCore.busInterfaces ?? []) {
    if ((bus.mode ?? '').toLowerCase() !== 'slave') {
      continue;
    }
    const info = registry.normalize(getString(bus.type));
    if (!registry.isMemoryMapped(info.templateType)) {
      continue;
    }
    const def = info.libraryKey ? busDefinitions[info.libraryKey] : undefined;
    if (!def?.ports) {
      continue;
    }
    const wdata = def.ports.find(
      (p) => typeof p.name === 'string' && /^(WDATA|writedata)$/.test(p.name)
    );
    const width = Number(wdata?.width);
    if (Number.isFinite(width) && width > 0) {
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
