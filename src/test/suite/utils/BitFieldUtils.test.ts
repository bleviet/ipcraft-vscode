import {
  formatBitsLike,
  parseBitsRange,
  parseBitsLike,
  formatBitsRange,
  fieldToBitsString,
} from '../../../webview/utils/BitFieldUtils';

describe('BitFieldUtils — standalone exports', () => {
  // -------------------------------------------------------------------------
  // parseBitsRange
  // -------------------------------------------------------------------------
  describe('parseBitsRange', () => {
    it('parses a range string [hi:lo]', () => {
      expect(parseBitsRange('[7:4]')).toEqual([7, 4]);
      expect(parseBitsRange('[31:0]')).toEqual([31, 0]);
      expect(parseBitsRange('[15:8]')).toEqual([15, 8]);
    });

    it('parses a single-bit string [n]', () => {
      expect(parseBitsRange('[0]')).toEqual([0, 0]);
      expect(parseBitsRange('[31]')).toEqual([31, 31]);
      expect(parseBitsRange('[5]')).toEqual([5, 5]);
    });

    it('parses [0:0] as the single bit 0', () => {
      expect(parseBitsRange('[0:0]')).toEqual([0, 0]);
    });

    it('returns null for invalid formats', () => {
      expect(parseBitsRange('')).toBeNull();
      expect(parseBitsRange('invalid')).toBeNull();
      expect(parseBitsRange('7:4')).toBeNull(); // missing brackets
      expect(parseBitsRange('[7-4]')).toBeNull(); // wrong separator
      expect(parseBitsRange('[a:b]')).toBeNull(); // non-numeric
    });
  });

  // -------------------------------------------------------------------------
  // formatBitsRange
  // -------------------------------------------------------------------------
  describe('formatBitsRange', () => {
    it('formats a multi-bit range as [hi:lo]', () => {
      expect(formatBitsRange(7, 4)).toBe('[7:4]');
      expect(formatBitsRange(31, 0)).toBe('[31:0]');
    });

    it('formats a single-bit range as [n:n]', () => {
      expect(formatBitsRange(5, 5)).toBe('[5:5]');
      expect(formatBitsRange(0, 0)).toBe('[0:0]');
      expect(formatBitsRange(31, 31)).toBe('[31:31]');
    });
  });

  // -------------------------------------------------------------------------
  // fieldToBitsString
  // -------------------------------------------------------------------------
  describe('fieldToBitsString', () => {
    it('computes from offset and width when both are present', () => {
      expect(fieldToBitsString({ offset: 0, width: 1 })).toBe('[0:0]');
      expect(fieldToBitsString({ offset: 4, width: 4 })).toBe('[7:4]');
      expect(fieldToBitsString({ offset: 0, width: 32 })).toBe('[31:0]');
    });

    it('prefers numeric offset/width over the bits string', () => {
      // Even when bits is provided, numeric fields take priority
      const field = { offset: 0, width: 8, bits: '[7:0]' };
      expect(fieldToBitsString(field)).toBe('[7:0]');
    });

    it('falls back to bits string when numeric fields are absent', () => {
      expect(fieldToBitsString({ bits: '[15:8]' })).toBe('[15:8]');
      expect(fieldToBitsString({ bits: '[31]' })).toBe('[31]');
    });

    it('returns [?:?] when neither numeric nor bits string is available', () => {
      expect(fieldToBitsString({})).toBe('[?:?]');
    });

    it('returns [?:?] when numeric fields are non-finite', () => {
      expect(fieldToBitsString({ offset: NaN, width: 8 })).toBe('[?:?]');
      expect(fieldToBitsString({ offset: 0, width: NaN })).toBe('[?:?]');
    });

    it('returns [?:?] when width is less than 1', () => {
      expect(fieldToBitsString({ offset: 0, width: 0 })).toBe('[?:?]');
    });
  });
});

describe('BitFieldUtils standalone helpers', () => {
  describe('parseBitsLike', () => {
    it('parses [hi:lo] to {offset, width}', () => {
      expect(parseBitsLike('[7:4]')).toEqual({ offset: 4, width: 4 });
      expect(parseBitsLike('[31:0]')).toEqual({ offset: 0, width: 32 });
    });

    it('parses [n] as a single bit', () => {
      expect(parseBitsLike('[5]')).toEqual({ offset: 5, width: 1 });
    });

    it('returns null for invalid strings', () => {
      expect(parseBitsLike('')).toBeNull();
      expect(parseBitsLike('invalid')).toBeNull();
    });
  });

  describe('formatBitsLike', () => {
    it('formats offset and width as [msb:lsb]', () => {
      expect(formatBitsLike(4, 4)).toBe('[7:4]');
      expect(formatBitsLike(0, 32)).toBe('[31:0]');
      expect(formatBitsLike(0, 1)).toBe('[0:0]');
    });
  });
});
