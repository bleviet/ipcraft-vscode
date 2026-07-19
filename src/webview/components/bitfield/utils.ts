import { getFieldColor } from '../../shared/colors';
import type { FieldModel } from '../BitFieldVisualizer';
import type { ProSegment } from './types';
import { BitVector } from '../../../dataInspector/BitVector';
import { normalizeFieldRange } from '../../../dataInspector/fieldGeometry';

export function getFieldRange(field: FieldModel): { lo: number; hi: number } | null {
  return normalizeFieldRange(field);
}

export function bitAt(value: number, bitIndex: number): 0 | 1 {
  if (!Number.isFinite(value) || bitIndex < 0) {
    return 0;
  }
  const div = Math.floor(value / Math.pow(2, bitIndex));
  return div % 2 === 1 ? 1 : 0;
}

export function setBit(value: number, bitIndex: number, desired: 0 | 1): number {
  const base = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  if (bitIndex < 0) {
    return base;
  }
  const current = bitAt(base, bitIndex);
  if (current === desired) {
    return base;
  }
  const delta = Math.pow(2, bitIndex);
  return desired === 1 ? base + delta : Math.max(0, base - delta);
}

export function parseRegisterValue(text: string, view: 'hex' | 'dec' = 'hex'): number | null {
  const s = text.trim();
  if (!s) {
    return null;
  }
  if (view === 'dec') {
    return /^-?\d+$/.test(s) ? Number(s) : null;
  }
  // Hex mode: digits are unambiguous even without a "0x" prefix (the UI shows
  // "0x" as a static label, not part of the editable text), but a pasted
  // "0x"/"0X" prefix is tolerated rather than rejected.
  const cleaned = s.replace(/^0[xX]/, '');
  return /^[0-9a-fA-F]+$/.test(cleaned) ? parseInt(cleaned, 16) : null;
}

/**
 * Result of parsing register-value bar text against a target width. `vector` is
 * non-null exactly when parsing succeeded; otherwise `error` distinguishes an
 * empty draft from malformed digits from a value that overflows the width, so
 * callers can surface a specific message instead of a generic one.
 */
export interface RegisterValueParse {
  vector: BitVector | null;
  error: 'malformed' | 'overflow' | null;
}

/** Debug-mode value parser backed by the shared exact-width vector engine. */
export function parseRegisterBitVector(
  text: string,
  view: 'hex' | 'dec',
  width: number
): RegisterValueParse {
  const source = text.trim();
  if (!source) {
    return { vector: null, error: null };
  }
  const cleaned = view === 'hex' ? source.replace(/^0[xX]/, '') : source;
  if (view === 'hex' ? !/^[0-9a-fA-F]+$/.test(cleaned) : !/^\d+$/.test(cleaned)) {
    return { vector: null, error: 'malformed' };
  }
  const value = BigInt(view === 'hex' ? `0x${cleaned}` : cleaned);
  try {
    return { vector: BitVector.fromBigInt(value, width), error: null };
  } catch {
    return { vector: null, error: 'overflow' };
  }
}

/** Hex digit width that fully represents a register of `bitCount` bits, e.g. 32 -> 8 digits. */
export function hexDigitsForBits(bitCount: number): number {
  return Math.max(1, Math.ceil(bitCount / 4));
}

export function extractBits(value: number, lo: number, width: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (width <= 0) {
    return 0;
  }
  const shifted = Math.floor(value / Math.pow(2, lo));
  const mask = width >= 53 ? Number.MAX_SAFE_INTEGER : Math.pow(2, width) - 1;
  return shifted % (mask + 1);
}

export function groupFields(fields: FieldModel[]) {
  const groups: {
    idx: number;
    start: number;
    end: number;
    name: string;
    color: string;
  }[] = [];
  fields.forEach((field, idx) => {
    let start = Number(field.bit ?? 0);
    let end = Number(field.bit ?? 0);
    if (field.bitRange) {
      [end, start] = field.bitRange;
    }
    if (start > end) {
      [start, end] = [end, start];
    }
    groups.push({
      idx,
      start,
      end,
      name: field.name ?? '',
      color: getFieldColor(field.name ?? `field${idx}`),
    });
  });
  groups.sort((a, b) => b.start - a.start);
  return groups;
}

export function buildProLayoutSegments(fields: FieldModel[], registerSize: number): ProSegment[] {
  const groups = groupFields(fields);
  const segments: ProSegment[] = [];
  const sorted = [...groups].sort((a, b) => b.end - a.end);

  let cursor = registerSize - 1;
  for (const group of sorted) {
    if (cursor > group.end) {
      segments.push({ type: 'gap', start: group.end + 1, end: cursor });
    }
    segments.push({ type: 'field', ...group });
    cursor = group.start - 1;
  }
  if (cursor >= 0) {
    segments.push({ type: 'gap', start: 0, end: cursor });
  }

  return segments;
}

export function repackSegments(segments: ProSegment[]): ProSegment[] {
  let currentBit = 0;
  return segments
    .slice()
    .reverse()
    .map((seg) => {
      const width = seg.end - seg.start + 1;
      const lo = currentBit;
      const hi = currentBit + width - 1;
      currentBit += width;
      return { ...seg, start: lo, end: hi };
    })
    .reverse();
}

export function toFieldRangeUpdates(
  segments: ProSegment[]
): { idx: number; range: [number, number] }[] {
  return segments
    .filter((seg): seg is Extract<ProSegment, { type: 'field' }> => seg.type === 'field')
    .map((seg) => ({ idx: seg.idx, range: [seg.end, seg.start] }));
}

export function buildBitOwnerArray(fields: FieldModel[], registerSize: number): (number | null)[] {
  const owners: (number | null)[] = Array.from({ length: registerSize }, () => null);
  fields.forEach((field, idx) => {
    const range = getFieldRange(field);
    if (range) {
      for (let bit = range.lo; bit <= range.hi; bit++) {
        if (bit >= 0 && bit < registerSize) {
          owners[bit] = idx;
        }
      }
    }
  });
  return owners;
}

export function getResizableEdges(
  fieldStart: number,
  fieldEnd: number,
  bitOwners: (number | null)[],
  registerSize: number
): {
  left: { canShrink: boolean; canExpand: boolean };
  right: { canShrink: boolean; canExpand: boolean };
} {
  const msbBit = Math.max(fieldStart, fieldEnd);
  const lsbBit = Math.min(fieldStart, fieldEnd);
  const fieldWidth = msbBit - lsbBit + 1;

  const canShrink = fieldWidth > 1;
  const hasGapLeft = lsbBit > 0 && bitOwners[lsbBit - 1] === null;
  const hasGapRight = msbBit < registerSize - 1 && bitOwners[msbBit + 1] === null;

  return {
    left: { canShrink, canExpand: hasGapLeft },
    right: { canShrink, canExpand: hasGapRight },
  };
}

export function findGapBoundaries(
  startBit: number,
  bits: (number | null)[],
  registerSize: number
): { minBit: number; maxBit: number } {
  let minBit = startBit;
  let maxBit = startBit;

  while (maxBit < registerSize - 1 && bits[maxBit + 1] === null) {
    maxBit++;
  }
  while (minBit > 0 && bits[minBit - 1] === null) {
    minBit--;
  }

  return { minBit, maxBit };
}

export function findResizeBoundary(
  fieldIndex: number,
  edge: 'msb' | 'lsb',
  fields: FieldModel[],
  registerSize: number
): number {
  const thisRange = getFieldRange(fields[fieldIndex]);
  if (!thisRange) {
    return edge === 'msb' ? registerSize - 1 : 0;
  }

  if (edge === 'msb') {
    let limit = registerSize - 1;
    for (let i = 0; i < fields.length; i++) {
      if (i === fieldIndex) {
        continue;
      }
      const r = getFieldRange(fields[i]);
      if (r && r.lo > thisRange.hi) {
        limit = Math.min(limit, r.lo - 1);
      }
    }
    return limit;
  }

  let limit = 0;
  for (let i = 0; i < fields.length; i++) {
    if (i === fieldIndex) {
      continue;
    }
    const r = getFieldRange(fields[i]);
    if (r && r.hi < thisRange.lo) {
      limit = Math.max(limit, r.hi + 1);
    }
  }
  return limit;
}

export function buildBitIndexArray(fields: FieldModel[], registerSize: number): (number | null)[] {
  const bits: (number | null)[] = Array.from({ length: registerSize }, () => null);
  fields.forEach((field, idx) => {
    if (field.bitRange) {
      const [hi, lo] = field.bitRange;
      for (let bit = lo; bit <= hi; bit++) {
        bits[bit] = idx;
      }
      return;
    }
    if (field.bit !== undefined) {
      bits[field.bit] = idx;
    }
  });
  return bits;
}

export function buildBitValues(fields: FieldModel[], registerSize: number): (0 | 1)[] {
  return buildRegisterBitVector(fields, registerSize).bitsMsbFirst().reverse() as (0 | 1)[];
}

/** Builds the transient register value without passing through JavaScript number arithmetic. */
export function buildRegisterBitVector(fields: FieldModel[], registerSize: number): BitVector {
  let vector = BitVector.filled(registerSize, 0);
  fields.forEach((field) => {
    const range = getFieldRange(field);
    if (!range) {
      return;
    }
    const raw = field?.resetValue;
    const fieldWidth = range.hi - range.lo + 1;
    let fieldVector: BitVector;
    try {
      const fieldValue =
        raw === null || raw === undefined
          ? BigInt(0)
          : typeof raw === 'bigint'
            ? raw
            : BigInt(Math.max(0, Math.trunc(raw)));
      fieldVector = BitVector.fromBigInt(fieldValue, fieldWidth);
    } catch {
      fieldVector = BitVector.filled(fieldWidth, 0);
    }
    for (let bit = Math.max(0, range.lo); bit <= Math.min(registerSize - 1, range.hi); bit++) {
      const localBit = bit - range.lo;
      vector = vector.withBit(bit, fieldVector.bit(localBit));
    }
  });
  return vector;
}

export function applyRegisterValueToFields(
  fields: FieldModel[],
  registerValue: number,
  onFieldReset: (fieldIndex: number, value: number) => void
): void {
  fields.forEach((field, fieldIndex) => {
    const range = getFieldRange(field);
    if (!range) {
      return;
    }
    const width = range.hi - range.lo + 1;
    const subValue = extractBits(registerValue, range.lo, width);
    onFieldReset(fieldIndex, subValue);
  });
}

export function applyRegisterBitVectorToFields(
  fields: FieldModel[],
  registerValue: BitVector,
  onFieldReset: (fieldIndex: number, value: number | bigint) => void
): void {
  fields.forEach((field, fieldIndex) => {
    const range = getFieldRange(field);
    if (!range || range.lo < 0 || range.hi >= registerValue.width) {
      return;
    }
    const value = registerValue.slice(range.hi, range.lo).toBigInt();
    if (value !== null) {
      onFieldReset(fieldIndex, value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value);
    }
  });
}
