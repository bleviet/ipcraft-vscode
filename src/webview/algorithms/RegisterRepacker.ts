/**
 * Register repacking algorithms for maintaining proper register layouts
 */

/**
 * Repack registers forward (toward higher offsets) starting from the given index.
 * Maintains 4-byte alignment.
 * @param registers Array of registers
 * @param fromIndex Starting index for repacking (inclusive)
 * @returns New array with repacked registers
 */
export function repackRegistersForward(
  registers: any[],
  fromIndex: number,
): any[] {
  const newRegs = [...registers];

  // Start from the register just before fromIndex to determine the starting position
  let nextOffset = fromIndex > 0 ? newRegs[fromIndex - 1].offset + 4 : 0;

  for (let i = fromIndex; i < newRegs.length; i++) {
    newRegs[i] = {
      ...newRegs[i],
      offset: nextOffset,
    };
    nextOffset += 4;
  }

  return newRegs;
}

/**
 * Repack registers backward (toward lower offsets) starting from the given index going backwards.
 * Maintains 4-byte alignment.
 * @param registers Array of registers
 * @param fromIndex Starting index for repacking (inclusive), goes backward to index 0
 * @returns New array with repacked registers
 */
export function repackRegistersBackward(
  registers: any[],
  fromIndex: number,
): any[] {
  const newRegs = [...registers];
  if (newRegs.length === 0) {
    return [];
  }

  // Start from the register just after fromIndex to determine the starting position
  let nextOffset =
    fromIndex < newRegs.length - 1
      ? newRegs[fromIndex + 1].offset - 4
      : Infinity;

  for (let i = fromIndex; i >= 0; i--) {
    const offset = nextOffset === Infinity ? newRegs[i].offset : nextOffset;
    newRegs[i] = {
      ...newRegs[i],
      offset: Math.max(0, offset),
    };
    nextOffset = offset - 4;
  }

  return newRegs;
}
