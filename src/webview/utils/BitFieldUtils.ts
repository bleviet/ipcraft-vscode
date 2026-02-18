/**
 * Result of parsing a bits-like string
 */
export interface BitsRange {
  bit_offset: number;
  bit_width: number;
}

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
