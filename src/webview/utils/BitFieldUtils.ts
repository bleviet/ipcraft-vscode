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

export interface BitFieldDef {
  bit_offset?: number | null;
  bit_width?: number | null;
  bits?: string | null;
}

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
  return `[${hi}:${lo}]`;
}

/**
 * Converts a field definition to its canonical bits string.
 * Computes from `bit_offset`/`bit_width` when available; falls back to the
 * `bits` property; returns `'[?:?]'` when neither can be determined.
 */
export function fieldToBitsString(field: BitFieldDef): string {
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

export function parseBitsLike(text: string): BitsRange | null {
  const trimmed = String(text ?? '')
    .trim()
    .replace(/\[|\]/g, '');
  if (!trimmed) {
    return null;
  }
  const parts = trimmed.split(':').map((part) => Number(String(part).trim()));
  if (parts.some((part) => Number.isNaN(part))) {
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

export function formatBitsLike(bit_offset: number, bit_width: number): string {
  const lsb = Number(bit_offset);
  const width = Math.max(1, Number(bit_width));
  const msb = lsb + width - 1;
  return `[${msb}:${lsb}]`;
}

export function isBitUsed(fields: BitFieldDef[], bitPosition: number): boolean {
  for (const field of fields) {
    const offset = Number(field?.bit_offset ?? 0);
    const width = Number(field?.bit_width ?? 1);
    if (bitPosition >= offset && bitPosition < offset + width) {
      return true;
    }
  }
  return false;
}

export function findFreeBit(fields: BitFieldDef[], maxBits = 32): number {
  const used = new Set<number>();
  for (const field of fields) {
    const offset = Number(field?.bit_offset ?? 0);
    const width = Number(field?.bit_width ?? 1);
    for (let bit = offset; bit < offset + width; bit++) {
      used.add(bit);
    }
  }

  let lsb = 0;
  while (used.has(lsb) && lsb < maxBits) {
    lsb++;
  }
  return lsb;
}

export function repackFieldsSequentially(fields: BitFieldDef[]): BitFieldDef[] {
  let offset = 0;
  for (const field of fields) {
    let width = Number(field?.bit_width);
    if (!Number.isFinite(width)) {
      const parsed = parseBitsLike(field?.bits ?? '');
      width = parsed?.bit_width ?? 1;
    }
    width = Math.max(1, Math.min(32, Math.trunc(width)));

    field.bit_offset = offset;
    field.bit_width = width;
    if (typeof field?.bits === 'string') {
      field.bits = formatBitsLike(offset, width);
    }
    offset += width;
  }

  return fields;
}
