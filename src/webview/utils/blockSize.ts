interface BlockRegisterLike {
  __kind?: string;
  count?: number | string;
  stride?: number | string;
}

interface BlockLike {
  size?: number | string;
  range?: number | string;
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

  let totalSize = 0;
  for (const reg of registers) {
    if (reg.__kind === 'array') {
      totalSize += parseNumeric(reg.count, 1) * parseNumeric(reg.stride, 4);
    } else {
      totalSize += 4;
    }
  }
  return totalSize;
}
