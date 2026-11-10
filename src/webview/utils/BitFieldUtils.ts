import { parseBitBounds, parseBitsRange } from '../../shared/bitRange';

/**
 * Result of parsing a bits-like string
 */
export interface BitsRange {
  offset: number;
  width: number;
}

// ---------------------------------------------------------------------------
// Standalone functional exports (preferred API for new code)
// ---------------------------------------------------------------------------

export interface BitFieldDef {
  offset?: number | null;
  width?: number | null;
  bits?: string | null;
}

function bitsLikeFromBounds(hi: number, lo: number): BitsRange | null {
  if (!Number.isFinite(hi) || !Number.isFinite(lo)) {
    return null;
  }
  const msb = Math.max(hi, lo);
  const lsb = Math.min(hi, lo);
  return { offset: lsb, width: msb - lsb + 1 };
}

export { parseBitsRange };

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
 * Computes from `offset`/`width` when available; falls back to the
 * `bits` property; returns `'[?:?]'` when neither can be determined.
 */
export function fieldToBitsString(field: BitFieldDef): string {
  const offset = Number(field?.offset ?? NaN);
  const width = Number(field?.width ?? NaN);
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

export function formatBitsLike(offset: number, width: number): string {
  const lsb = Number(offset);
  const w = Math.max(1, Number(width));
  const msb = lsb + w - 1;
  return formatBitsRange(msb, lsb);
}

/**
 * Checks if a bits string represents a simple vector range like '[15:8]', '[7]', or '[?:?]'.
 */
export function isSimpleVector(value: string): boolean {
  const trimmed = value.trim();
  return /^\[(?:\d+|\?)(?::(?:\d+|\?))?\]$/.test(trimmed);
}
