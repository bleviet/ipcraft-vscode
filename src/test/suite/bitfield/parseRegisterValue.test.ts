import {
  applyRegisterBitVectorToFields,
  buildRegisterBitVector,
  hexDigitsForBits,
  parseRegisterBitVector,
  parseRegisterValue,
} from '../../../webview/components/bitfield/utils';
import { BitVector } from '../../../dataInspector/BitVector';

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
    expect(parseRegisterBitVector('FEDCBA9876543210', 'hex', 64).vector?.toLiteral()).toBe(
      "64'hFEDCBA9876543210"
    );
  });

  it('rejects values that do not fit instead of truncating', () => {
    expect(parseRegisterBitVector('100', 'hex', 8)).toEqual({ vector: null, error: 'overflow' });
  });

  it('reports malformed digits distinctly from an empty draft', () => {
    expect(parseRegisterBitVector('zz', 'hex', 8)).toEqual({ vector: null, error: 'malformed' });
    expect(parseRegisterBitVector('', 'hex', 8)).toEqual({ vector: null, error: null });
  });
});

describe('exact register field values', () => {
  it('keeps wide field values as bigint instead of rounding through number', () => {
    const fields = [{ bitRange: [63, 0] as [number, number], resetValue: BigInt(0) }];
    const value = BitVector.fromBigInt(BigInt('0xFEDCBA9876543210'), 64);
    const onFieldReset = jest.fn();

    applyRegisterBitVectorToFields(fields, value, onFieldReset);

    expect(onFieldReset).toHaveBeenCalledWith(0, BigInt('0xFEDCBA9876543210'));
    expect(
      buildRegisterBitVector(
        [{ ...fields[0], resetValue: BigInt('0xFEDCBA9876543210') }],
        64
      ).toLiteral()
    ).toBe("64'hFEDCBA9876543210");
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
