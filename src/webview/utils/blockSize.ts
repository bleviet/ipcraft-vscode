interface BlockRegisterLike {
  __kind?: string;
  count?: number | string;
  stride?: number | string;
}

interface BlockLike {
  size?: number | string;
  range?: number | string | null;
  registers?: BlockRegisterLike[];
}

function parseNumeric(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function calculateBlockSize(block: BlockLike): number {
  const registers = block?.registers ?? [];
  if (registers.length === 0) {
    return parseNumeric(block?.size ?? block?.range, 4);
  }

  let maxEnd = 0;
  for (const reg of registers) {
    const regRec = reg as Record<string, unknown>;
    const offset = parseNumeric(regRec.address_offset ?? regRec.offset, 0);
    let size = 4;
    if (reg.__kind === 'array') {
      size = parseNumeric(reg.count, 1) * parseNumeric(reg.stride, 4);
    }
    maxEnd = Math.max(maxEnd, offset + size);
  }

  // If the block has a minimum explicitly set size that is larger than the registers' footprint,
  // we could return that, but usually the footprint dictates the actual used size.
  // We return the maximum extent of the registers.
  return maxEnd;
}
