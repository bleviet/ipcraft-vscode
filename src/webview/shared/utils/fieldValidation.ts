export interface FieldValidationInput {
  bits?: string | null;
  bit_width?: number | null;
  bit_range?: [number, number] | null;
}

export function parseBitsWidth(bits: string): number | null {
  const match = bits.trim().match(/^\[(\d+)(?::(\d+))?\]$/);
  if (!match) {
    return null;
  }
  const n = Number.parseInt(match[1], 10);
  const m = match[2] ? Number.parseInt(match[2], 10) : n;
  return Math.abs(n - m) + 1;
}

export function validateBitsString(bits: string): string | null {
  const trimmed = bits.trim();
  if (!/^\[\d+(?::\d+)?\]$/.test(trimmed)) {
    return 'Format must be [N:M] or [N]';
  }
  const match = trimmed.match(/\[(\d+)(?::(\d+))?\]/);
  if (!match) {
    return 'Invalid format';
  }
  const n = Number.parseInt(match[1], 10);
  const m = match[2] ? Number.parseInt(match[2], 10) : n;
  if (n < 0 || m < 0) {
    return 'Bit indices must be >= 0';
  }
  if (n < m) {
    return 'MSB must be >= LSB';
  }
  return null;
}

export function parseBitsInput(text: string) {
  const trimmed = text.trim().replace(/[\[\]]/g, '');
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split(':').map((p) => Number(p.trim()));
  if (parts.some((p) => Number.isNaN(p))) {
    return null;
  }

  let msb: number;
  let lsb: number;
  if (parts.length === 1) {
    msb = parts[0];
    lsb = parts[0];
  } else {
    [msb, lsb] = parts as [number, number];
  }

  if (!Number.isFinite(msb) || !Number.isFinite(lsb)) {
    return null;
  }

  if (msb < lsb) {
    const tmp = msb;
    msb = lsb;
    lsb = tmp;
  }

  return {
    bit_offset: lsb,
    bit_width: msb - lsb + 1,
    bit_range: [msb, lsb] as [number, number],
  };
}

export function parseReset(text: string): number | null {
  const s = text.trim();
  if (!s) {
    return null;
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export function getFieldBitWidth(field: FieldValidationInput): number {
  const width = Number(field?.bit_width);
  if (Number.isFinite(width) && width > 0) {
    return width;
  }

  const bitRange = field?.bit_range;
  if (Array.isArray(bitRange) && bitRange.length === 2) {
    const msb = Number(bitRange[0]);
    const lsb = Number(bitRange[1]);
    if (Number.isFinite(msb) && Number.isFinite(lsb)) {
      return Math.abs(msb - lsb) + 1;
    }
  }

  return 1;
}

export function validateResetForField(
  field: FieldValidationInput,
  value: number | null
): string | null {
  if (value === null) {
    return null;
  }
  if (!Number.isFinite(value)) {
    return 'Invalid number';
  }
  if (value < 0) {
    return 'Reset must be >= 0';
  }

  const width = getFieldBitWidth(field);
  const max = width >= 53 ? Number.MAX_SAFE_INTEGER : Math.pow(2, width) - 1;
  if (value > max) {
    return `Reset too large for ${width} bit(s)`;
  }
  return null;
}
