/**
 * Bit field repacking algorithms for maintaining proper bit field layouts
 */

import type { BitFieldRecord } from '../types/editor';
import {
  parseBitsRange,
  formatBitsRange as formatBits,
  fieldToBitsString,
} from '../utils/BitFieldUtils';

// Re-export canonical implementations from BitFieldUtils so that
// BitFieldRepacker consumers and test suites continue to work unchanged.
export { parseBitsRange, formatBitsRange as formatBits } from '../utils/BitFieldUtils';

/**
 * Repack only the updated field and subsequent fields, preserving order
 * @param fields Array of bit fields
 * @param regWidth Register width in bits
 * @param startIdx Starting index for repacking
 * @returns New array with repacked fields
 */
export function repackFieldsFrom(
  fields: BitFieldRecord[],
  regWidth: number,
  startIdx: number
): BitFieldRecord[] {
  // Calculate starting MSB for the updated field
  let nextMsb = regWidth - 1;
  if (startIdx > 0) {
    // Previous field's LSB
    const prev = fields[startIdx - 1];
    const prevRange = parseBitsRange(fieldToBitsString(prev));
    if (prevRange) {
      nextMsb = prevRange[1] - 1;
    }
  }
  const newFields = [...fields];
  for (let i = startIdx; i < fields.length; ++i) {
    let width = 1;
    const parsed = parseBitsRange(fieldToBitsString(newFields[i]));
    if (parsed) {
      width = Math.abs(parsed[0] - parsed[1]) + 1;
    }
    const msb = nextMsb;
    let lsb = msb - width + 1;
    // Clamp LSB to zero
    if (lsb < 0) {
      lsb = 0;
    }
    nextMsb = lsb - 1;
    newFields[i] = {
      ...newFields[i],
      bits: formatBits(msb, lsb),
      bit_offset: lsb,
      bit_width: width,
      bit_range: [msb, lsb] as [number, number],
    };
  }
  return newFields;
}

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

/**
 * Backward-compatible alias for callers that still reference the old API name.
 * Prefer `repackFieldsBackward` in new code.
 */
export const repackFieldsDownward = repackFieldsBackward;
