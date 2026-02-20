/**
 * Register repacking algorithms for maintaining proper register layouts
 */

import type { RegisterRecord } from '../types/editor';

function registerFootprint(reg: RegisterRecord): number {
  const rec = reg as Record<string, unknown>;
  const count = rec.count as number | undefined;
  const stride = rec.stride as number | undefined;
  if (typeof count === 'number' && count > 1) {
    return (stride ?? 4) * count;
  }

  const bits = typeof reg.size === 'number' && reg.size > 0 ? reg.size : 32;
  return Math.max(1, Math.floor(bits / 8));
}

/**
 * Repack registers forward (toward higher offsets) starting from the given index.
 * Maintains 4-byte alignment.
 * @param registers Array of registers
 * @param fromIndex Starting index for repacking (inclusive)
 * @returns New array with repacked registers
 */
export function repackRegistersForward(
  registers: RegisterRecord[],
  fromIndex: number
): RegisterRecord[] {
  const newRegs = [...registers];
  if (fromIndex < 0 || fromIndex >= newRegs.length) {
    return newRegs;
  }

  // Start from the register just before fromIndex to determine the starting position
  let nextOffset =
    fromIndex > 0
      ? (newRegs[fromIndex - 1].offset ?? 0) + registerFootprint(newRegs[fromIndex - 1])
      : 0;

  for (let i = fromIndex; i < newRegs.length; i++) {
    newRegs[i] = {
      ...newRegs[i],
      offset: nextOffset,
    };
    nextOffset += registerFootprint(newRegs[i]);
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
  registers: RegisterRecord[],
  fromIndex: number
): RegisterRecord[] {
  const newRegs = [...registers];
  if (newRegs.length === 0) {
    return [];
  }
  if (fromIndex < 0 || fromIndex >= newRegs.length) {
    return newRegs;
  }

  // Start from the register just after fromIndex to determine the starting position.
  // `Infinity` means "preserve current offset" for the first processed element.
  let nextOffset: number =
    fromIndex < newRegs.length - 1
      ? (newRegs[fromIndex + 1].offset ?? 0) - registerFootprint(newRegs[fromIndex])
      : Infinity;

  for (let i = fromIndex; i >= 0; i--) {
    const offset = nextOffset === Infinity ? (newRegs[i].offset ?? 0) : nextOffset;
    newRegs[i] = {
      ...newRegs[i],
      offset: Math.max(0, offset),
    };
    nextOffset = offset - registerFootprint(newRegs[Math.max(0, i - 1)] ?? newRegs[i]);
  }

  return newRegs;
}
