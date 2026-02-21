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

function parseBitBounds(bits: string, requireBrackets: boolean): [number, number] | null {
  const source = String(bits ?? '').trim();
  if (!source) {
    return null;
  }

  const normalized = source.replace(/\s+/g, '');
  const bracketedMatch = normalized.match(/^\[(\d+)(?::(\d+))?\]$/);
  if (bracketedMatch) {
    const hi = Number(bracketedMatch[1]);
    const lo = Number(bracketedMatch[2] ?? bracketedMatch[1]);
    return [hi, lo];
  }

  if (requireBrackets) {
    return null;
  }

  const bareMatch = normalized.match(/^(\d+)(?::(\d+))?$/);
  if (!bareMatch) {
    return null;
  }

  const hi = Number(bareMatch[1]);
  const lo = Number(bareMatch[2] ?? bareMatch[1]);
  return [hi, lo];
}

function bitsLikeFromBounds(hi: number, lo: number): BitsRange | null {
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
    return null;
  }
  const msb = Math.max(hi, lo);
  const lsb = Math.min(hi, lo);
  return { bit_offset: lsb, bit_width: msb - lsb + 1 };
}

/**
 * Parses a bits string '[hi:lo]' or '[n]' into [hi, lo].
 * Returns null if the format is unrecognised.
 */
export function parseBitsRange(bits: string): [number, number] | null {
  return parseBitBounds(bits, true);
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
  const bounds = parseBitBounds(text, false);
  if (!bounds) {
    return null;
  }
  return bitsLikeFromBounds(bounds[0], bounds[1]);
}

export function formatBitsLike(bit_offset: number, bit_width: number): string {
  const lsb = Number(bit_offset);
  const width = Math.max(1, Number(bit_width));
  const msb = lsb + width - 1;
  return formatBitsRange(msb, lsb);
}
