/**
 * Result of parsing a bits-like string
 */
export interface BitsRange {
  bit_offset: number;
  bit_width: number;
}

// ---------------------------------------------------------------------------
// Standalone functional exports (preferred API for new code)
// ---------------------------------------------------------------------------

/**
 * Parses a bits string '[hi:lo]' or '[n]' into [hi, lo].
 * Returns null if the format is unrecognised.
 */
export function parseBitsRange(bits: string): [number, number] | null {
  if (!bits) {
    return null;
  }
  const rangeMatch = bits.match(/^\[(\d+):(\d+)\]$/);
  if (rangeMatch) {
    return [parseInt(rangeMatch[1], 10), parseInt(rangeMatch[2], 10)];
  }
  const singleMatch = bits.match(/^\[(\d+)\]$/);
  if (singleMatch) {
    return [parseInt(singleMatch[1], 10), parseInt(singleMatch[1], 10)];
  }
  return null;
}

/**
 * Formats a bit range as '[hi:lo]' or '[hi]' for single bits.
 *
 * @param hi Most-significant bit index.
 * @param lo Least-significant bit index.
 */
export function formatBitsRange(hi: number, lo: number): string {
  return hi === lo ? `[${hi}]` : `[${hi}:${lo}]`;
}

/**
 * Converts a field definition to its canonical bits string.
 * Computes from `bit_offset`/`bit_width` when available; falls back to the
 * `bits` property; returns `'[?:?]'` when neither can be determined.
 */
export function fieldToBitsString(field: {
  bit_offset?: number | null;
  bit_width?: number | null;
  bits?: string;
}): string {
  const offset = Number(field?.bit_offset ?? NaN);
  const width = Number(field?.bit_width ?? NaN);
  if (Number.isFinite(offset) && Number.isFinite(width) && width >= 1) {
    return formatBitsRange(offset + width - 1, offset);
  }
  if (typeof field?.bits === 'string' && field.bits) {
    return field.bits;
  }
  return '[?:?]';
}

// ---------------------------------------------------------------------------
// Class-based API (legacy — kept for backward compatibility)
// ---------------------------------------------------------------------------

/**
 * Utility functions for bit field formatting and parsing
 */
export class BitFieldUtils {
  /**
   * Parse a bits-like string (e.g., "[31:0]", "[5:5]") to bit offset and width
   * @param text Bits string like "[31:0]"
   * @returns Parsed bits range or null if invalid
   */
  static parseBitsLike(text: string): BitsRange | null {
    const trimmed = String(text ?? '')
      .trim()
      .replace(/\[|\]/g, '');
    if (!trimmed) {
      return null;
    }
    const parts = trimmed.split(':').map((p) => Number(String(p).trim()));
    if (parts.some((p) => Number.isNaN(p))) {
      return null;
    }
    let msb: number;
    let lsb: number;
    if (parts.length === 1) {
      msb = parts[0];
      lsb = parts[0];
    } else {
      msb = parts[0];
      lsb = parts[1];
    }
    if (!Number.isFinite(msb) || !Number.isFinite(lsb)) {
      return null;
    }
    if (msb < lsb) {
      [msb, lsb] = [lsb, msb];
    }
    return { bit_offset: lsb, bit_width: msb - lsb + 1 };
  }

  /**
   * Format bit offset and width as a bits-like string (e.g., "[31:0]")
   * @param bit_offset Least significant bit position
   * @param bit_width Width of the field in bits
   * @returns Formatted bits string
   */
  static formatBitsLike(bit_offset: number, bit_width: number): string {
    const lsb = Number(bit_offset);
    const width = Math.max(1, Number(bit_width));
    const msb = lsb + width - 1;
    return `[${msb}:${lsb}]`;
  }

  /**
   * Check if a specific bit is used in any of the given fields
   * @param fields Array of field objects with bit_offset and bit_width
   * @param bitPosition Bit position to check
   * @returns True if the bit is used
   */
  static isBitUsed(fields: any[], bitPosition: number): boolean {
    for (const f of fields) {
      const offset = Number(f?.bit_offset ?? 0);
      const width = Number(f?.bit_width ?? 1);
      if (bitPosition >= offset && bitPosition < offset + width) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find the first free bit position in the range [0, maxBits)
   * @param fields Array of field objects with bit_offset and bit_width
   * @param maxBits Maximum bit position to check (default 32)
   * @returns First free bit position or maxBits if all are used
   */
  static findFreeBit(fields: any[], maxBits = 32): number {
    const used = new Set<number>();
    for (const f of fields) {
      const offset = Number(f?.bit_offset ?? 0);
      const width = Number(f?.bit_width ?? 1);
      for (let b = offset; b < offset + width; b++) {
        used.add(b);
      }
    }
    let lsb = 0;
    while (used.has(lsb) && lsb < maxBits) {
      lsb++;
    }
    return lsb;
  }

  /**
   * Repack field bit offsets sequentially based on their widths
   * @param fields Array of field objects to repack
   * @returns Updated array of fields with sequential bit offsets
   */
  static repackFieldsSequentially(fields: any[]): any[] {
    let offset = 0;
    for (const f of fields) {
      let width = Number(f?.bit_width);
      if (!Number.isFinite(width)) {
        const parsed = BitFieldUtils.parseBitsLike(f?.bits);
        width = parsed?.bit_width ?? 1;
      }
      width = Math.max(1, Math.min(32, Math.trunc(width)));

      f.bit_offset = offset;
      f.bit_width = width;
      // Keep legacy "bits" in sync if it exists
      if (typeof f?.bits === 'string') {
        f.bits = BitFieldUtils.formatBitsLike(offset, width);
      }
      offset += width;
    }
    return fields;
  }
}
