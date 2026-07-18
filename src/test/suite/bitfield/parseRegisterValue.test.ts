import {
  hexDigitsForBits,
  parseRegisterBitVector,
  parseRegisterValue,
} from '../../../webview/components/bitfield/utils';

describe('parseRegisterValue', () => {
  describe('hex view', () => {
    it('parses bare hex digits without requiring a "0x" prefix', () => {
      expect(parseRegisterValue('10', 'hex')).toBe(0x10);
    });

    it('parses hex digits that include letters', () => {
      expect(parseRegisterValue('AA', 'hex')).toBe(0xaa);
      expect(parseRegisterValue('ab', 'hex')).toBe(0xab);
    });

    it('still tolerates a pasted "0x"/"0X" prefix', () => {
      expect(parseRegisterValue('0x10', 'hex')).toBe(0x10);
      expect(parseRegisterValue('0X1a', 'hex')).toBe(0x1a);
    });

    it('rejects non-hex characters', () => {
      expect(parseRegisterValue('1g', 'hex')).toBeNull();
      expect(parseRegisterValue('', 'hex')).toBeNull();
    });
  });

  describe('dec view', () => {
    it('parses plain decimal digits', () => {
      expect(parseRegisterValue('10', 'dec')).toBe(10);
    });

    it('rejects hex-only letters in decimal mode', () => {
      expect(parseRegisterValue('AA', 'dec')).toBeNull();
    });

    it('rejects non-numeric characters', () => {
      expect(parseRegisterValue('1.5', 'dec')).toBeNull();
      expect(parseRegisterValue('', 'dec')).toBeNull();
    });
  });
});

describe('parseRegisterBitVector', () => {
  it('preserves a 64-bit debug value exactly', () => {
    expect(parseRegisterBitVector('FEDCBA9876543210', 'hex', 64)?.toLiteral()).toBe(
      "64'hFEDCBA9876543210"
    );
  });

  it('rejects values that do not fit instead of truncating', () => {
    expect(parseRegisterBitVector('100', 'hex', 8)).toBeNull();
  });
});

describe('hexDigitsForBits', () => {
  it('pads to a whole nibble count for the register width', () => {
    expect(hexDigitsForBits(32)).toBe(8);
    expect(hexDigitsForBits(16)).toBe(4);
    expect(hexDigitsForBits(12)).toBe(3);
    expect(hexDigitsForBits(1)).toBe(1);
  });
});
