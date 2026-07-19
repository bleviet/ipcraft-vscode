import { BitVector } from '../../../dataInspector/BitVector';
import { parseLiteral } from '../../../dataInspector/parseLiteral';
import { applyTransform } from '../../../dataInspector/transforms';

describe('BitVector', () => {
  it.each([64, 128, 1024, 4096])('round-trips an exact %i-bit value', (width) => {
    const digits = 'A5'.repeat(width / 8);
    const parsed = parseLiteral(`${width}'h${digits}`);

    expect(parsed.vector.width).toBe(width);
    expect(parsed.vector.toLiteral()).toBe(`${width}'h${digits}`);
    expect(parseLiteral(parsed.vector.toLiteral()).vector.equals(parsed.vector)).toBe(true);
  });

  it('preserves leading zeros and values above the safe integer boundary', () => {
    const parsed = parseLiteral("64'h00FF_FFFF_FFFF_FFFF");

    expect(parsed.vector.width).toBe(64);
    expect(parsed.vector.toBigInt()).toBe(BigInt('0x00ffffffffffffff'));
    expect(parsed.vector.toLiteral()).toBe("64'h00FFFFFFFFFFFFFF");
  });

  it('preserves strong X and Z states in exact serialization', () => {
    const parsed = parseLiteral("16'b0000_XXXX_0011_ZZZZ");

    expect(parsed.vector.toBinary()).toBe('0000XXXX0011ZZZZ');
    expect(parsed.vector.toLiteral()).toBe("16'h0X3Z");
    expect(parseLiteral(parsed.vector.toLiteral()).vector.equals(parsed.vector)).toBe(true);
  });

  it('uses binary serialization when a mixed unknown nibble cannot be represented in hex', () => {
    const parsed = parseLiteral("4'b01XZ");

    expect(parsed.vector.toHex()).toBeNull();
    expect(parsed.vector.toLiteral()).toBe("4'b01XZ");
  });

  it('implements the conservative four-state truth tables', () => {
    const unresolved = parseLiteral("4'bXZ10").vector;
    const operand = parseLiteral("4'b0101").vector;

    expect(unresolved.and(operand).toBinary()).toBe('0X00');
    expect(unresolved.or(operand).toBinary()).toBe('X111');
    expect(unresolved.xor(operand).toBinary()).toBe('XX11');
    expect(unresolved.not().toBinary()).toBe('XX01');
  });

  it('keeps concat operand order explicit', () => {
    const a = parseLiteral("8'h12").vector;
    const b = parseLiteral("8'h34").vector;

    expect(a.concat(b).toLiteral()).toBe("16'h1234");
    expect(b.concat(a).toLiteral()).toBe("16'h3412");
  });

  it('keeps byte swap, bit reversal, and concatenation distinct', () => {
    const value = parseLiteral("16'h12A0").vector;

    expect(value.byteSwap().toLiteral()).toBe("16'hA012");
    expect(value.reverseBits().toLiteral()).toBe("16'h0548");
    expect(value.slice(15, 8).concat(value.slice(7, 0)).toLiteral()).toBe("16'h12A0");
  });

  it('shifts at fixed width, inserts zero, and zeroes overshifts', () => {
    const value = parseLiteral("4'bX101").vector;

    expect(value.shiftLeft(1).toBinary()).toBe('1010');
    expect(value.shiftRight(1).toBinary()).toBe('0X10');
    expect(value.shiftLeft(4).toBinary()).toBe('0000');
    expect(value.shiftRight(9).toBinary()).toBe('0000');
  });

  it('extends and truncates explicitly, treating an unknown sign as X', () => {
    const known = parseLiteral("4'b1010").vector;
    const unknownSign = parseLiteral("4'bZ010").vector;

    expect(known.zeroExtend(8).toBinary()).toBe('00001010');
    expect(known.signExtend(8).toBinary()).toBe('11111010');
    expect(unknownSign.signExtend(8).toBinary()).toBe('XXXXZ010');
    expect(known.truncate(2).toBinary()).toBe('10');
  });

  it('reports the dropped and inserted ranges for width-affecting transforms', () => {
    const value = parseLiteral("8'hA5").vector;

    expect(applyTransform(value, { type: 'shiftRight', amount: 3 })).toMatchObject({
      value: expect.any(BitVector),
      droppedRanges: [{ msb: 2, lsb: 0 }],
      insertedRange: { msb: 7, lsb: 5, state: '0' },
    });
    expect(applyTransform(value, { type: 'truncate', width: 4 })).toMatchObject({
      droppedRanges: [{ msb: 7, lsb: 4 }],
    });
  });
});
