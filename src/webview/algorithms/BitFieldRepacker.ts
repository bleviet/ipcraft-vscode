/**
 * Bit field repacking algorithms for maintaining proper bit field layouts
 */

import type { BitFieldRecord } from '../types/editor';
import { parseBitsRange, formatBitsRange, fieldToBitsString } from '../utils/BitFieldUtils';

const formatBits = formatBitsRange;

/**
 * Repack bit fields forward (toward MSB/Higher Bits) starting from the given index.
 * Used for LSB-ascending sorted arrays.
 * Ensures fields[i] is placed immediately after fields[i-1].
 */
export function repackFieldsForward(
  fields: BitFieldRecord[],
  fromIndex: number,
  regWidth: number
): BitFieldRecord[] {
  const newFields = [...fields];
  if (fromIndex < 0 || fromIndex >= newFields.length) {
    return newFields;
  }

  let nextLsb =
    fromIndex > 0
      ? (() => {
          const prev = newFields[fromIndex - 1];
          const prevRange = parseBitsRange(fieldToBitsString(prev));
          return prevRange ? prevRange[0] + 1 : 0; // Previous MSB + 1
        })()
      : 0;

  for (let i = fromIndex; i < newFields.length; i++) {
    const field = newFields[i];
    const parsed = parseBitsRange(fieldToBitsString(field));
    const width = parsed ? Math.abs(parsed[0] - parsed[1]) + 1 : 1;

    const lsb = nextLsb;
    // Clamp MSB so partially invalid source widths cannot overflow the register.
    const msb = Math.min(regWidth - 1, lsb + width - 1);
    const clampedWidth = msb - lsb + 1;
    nextLsb = msb + 1;

    newFields[i] = {
      ...field,
      bits: formatBits(msb, lsb),
      bit_offset: lsb,
      bit_width: clampedWidth,
      bit_range: [msb, lsb] as [number, number],
    };
  }

  return newFields;
}

/**
 * Repack bit fields backward (toward LSB/Lower Bits) starting from the given index going backwards.
 * Used for LSB-ascending sorted arrays.
 * Ensures fields[i] is placed immediately before fields[i+1].
 */
export function repackFieldsBackward(
  fields: BitFieldRecord[],
  fromIndex: number,
  regWidth: number
): BitFieldRecord[] {
  const newFields = [...fields];
  if (fromIndex < 0 || fromIndex >= newFields.length) {
    return newFields;
  }

  let nextMsb =
    fromIndex < newFields.length - 1
      ? (() => {
          const next = newFields[fromIndex + 1];
          const nextRange = parseBitsRange(fieldToBitsString(next));
          return nextRange ? nextRange[1] - 1 : regWidth - 1; // Next LSB - 1
        })()
      : regWidth - 1;

  for (let i = fromIndex; i >= 0; i--) {
    const field = newFields[i];
    const parsed = parseBitsRange(fieldToBitsString(field));
    const width = parsed ? Math.abs(parsed[0] - parsed[1]) + 1 : 1;

    const msb = nextMsb;
    // Clamp to bit 0 so backward repacking never produces negative bit indices.
    const lsb = Math.max(0, msb - width + 1);
    const clampedWidth = msb - lsb + 1;
    nextMsb = lsb - 1;

    newFields[i] = {
      ...field,
      bits: formatBits(msb, lsb),
      bit_offset: lsb,
      bit_width: clampedWidth,
      bit_range: [msb, lsb] as [number, number],
    };
  }

  return newFields;
}
