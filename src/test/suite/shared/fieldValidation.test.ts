import {
  parseBitsWidth,
  validateBitsString,
  parseBitsInput,
  parseReset,
  getFieldBitWidth,
  validateResetForField,
} from '../../../webview/shared/utils/fieldValidation';

// ---------------------------------------------------------------------------
// parseBitsWidth
// ---------------------------------------------------------------------------

describe('parseBitsWidth', () => {
  it('parses single-bit format [N]', () => {
    expect(parseBitsWidth('[7]')).toBe(1);
    expect(parseBitsWidth('[0]')).toBe(1);
  });

  it('parses range format [N:M]', () => {
    expect(parseBitsWidth('[7:0]')).toBe(8);
    expect(parseBitsWidth('[3:0]')).toBe(4);
    expect(parseBitsWidth('[31:16]')).toBe(16);
  });

  it('handles whitespace', () => {
    expect(parseBitsWidth('  [7:0]  ')).toBe(8);
  });

  it('returns null for invalid formats', () => {
    expect(parseBitsWidth('')).toBeNull();
    expect(parseBitsWidth('7:0')).toBeNull();
    expect(parseBitsWidth('[abc]')).toBeNull();
    expect(parseBitsWidth('hello')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// validateBitsString
// ---------------------------------------------------------------------------

describe('validateBitsString', () => {
  it('accepts valid formats', () => {
    expect(validateBitsString('[7:0]')).toBeNull();
    expect(validateBitsString('[0]')).toBeNull();
    expect(validateBitsString('[31:16]')).toBeNull();
  });

  it('rejects missing brackets', () => {
    expect(validateBitsString('7:0')).not.toBeNull();
  });

  it('rejects MSB < LSB', () => {
    expect(validateBitsString('[0:7]')).toBe('MSB must be >= LSB');
  });

  it('rejects non-numeric content', () => {
    expect(validateBitsString('[a:b]')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseBitsInput
// ---------------------------------------------------------------------------

describe('parseBitsInput', () => {
  it('parses bracketed range', () => {
    const result = parseBitsInput('[7:0]');
    expect(result).toEqual({ bit_offset: 0, bit_width: 8, bit_range: [7, 0] });
  });

  it('parses bare range without brackets', () => {
    const result = parseBitsInput('7:0');
    expect(result).toEqual({ bit_offset: 0, bit_width: 8, bit_range: [7, 0] });
  });

  it('parses single bit', () => {
    const result = parseBitsInput('5');
    expect(result).toEqual({ bit_offset: 5, bit_width: 1, bit_range: [5, 5] });
  });

  it('auto-swaps reversed ranges', () => {
    const result = parseBitsInput('0:7');
    expect(result).toEqual({ bit_offset: 0, bit_width: 8, bit_range: [7, 0] });
  });

  it('returns null for empty input', () => {
    expect(parseBitsInput('')).toBeNull();
    expect(parseBitsInput('  ')).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(parseBitsInput('abc')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseReset
// ---------------------------------------------------------------------------

describe('parseReset', () => {
  it('parses decimal numbers', () => {
    expect(parseReset('42')).toBe(42);
    expect(parseReset('0')).toBe(0);
  });

  it('parses hex numbers', () => {
    expect(parseReset('0xFF')).toBe(255);
  });

  it('returns null for empty string', () => {
    expect(parseReset('')).toBeNull();
    expect(parseReset('  ')).toBeNull();
  });

  it('returns null for non-numeric', () => {
    expect(parseReset('abc')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getFieldBitWidth
// ---------------------------------------------------------------------------

describe('getFieldBitWidth', () => {
  it('uses bit_width when available', () => {
    expect(getFieldBitWidth({ bit_width: 8 })).toBe(8);
  });

  it('computes from bit_range when bit_width is missing', () => {
    expect(getFieldBitWidth({ bit_range: [7, 0] })).toBe(8);
    expect(getFieldBitWidth({ bit_range: [3, 3] })).toBe(1);
  });

  it('defaults to 1 when nothing is available', () => {
    expect(getFieldBitWidth({})).toBe(1);
    expect(getFieldBitWidth({ bit_width: null })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// validateResetForField
// ---------------------------------------------------------------------------

describe('validateResetForField', () => {
  it('accepts null reset value', () => {
    expect(validateResetForField({ bit_width: 8 }, null)).toBeNull();
  });

  it('accepts valid reset value within range', () => {
    expect(validateResetForField({ bit_width: 8 }, 255)).toBeNull();
    expect(validateResetForField({ bit_width: 1 }, 0)).toBeNull();
    expect(validateResetForField({ bit_width: 1 }, 1)).toBeNull();
  });

  it('rejects negative reset value', () => {
    expect(validateResetForField({ bit_width: 8 }, -1)).toBe('Reset must be >= 0');
  });

  it('rejects reset value too large for field width', () => {
    expect(validateResetForField({ bit_width: 1 }, 2)).toBe('Reset too large for 1 bit(s)');
    expect(validateResetForField({ bit_width: 8 }, 256)).toBe('Reset too large for 8 bit(s)');
  });

  it('rejects non-finite numbers', () => {
    expect(validateResetForField({ bit_width: 8 }, Infinity)).toBe('Invalid number');
    expect(validateResetForField({ bit_width: 8 }, NaN)).toBe('Invalid number');
  });
});
