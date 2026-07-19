import {
  compareExpected,
  decodeEnum,
  decodeFixedPoint,
  decodeFloat,
  decodeSigned,
  decodeUnsigned,
} from '../../../dataInspector/numericDecode';
import { parseLiteral } from '../../../dataInspector/parseLiteral';

const vector = (literal: string) => parseLiteral(literal).vector;

describe('numeric decoding', () => {
  it('decodes exact unsigned and signed integers above the safe integer boundary', () => {
    expect(decodeUnsigned(vector("64'hFEDCBA9876543210"))).toEqual({
      status: 'ok',
      text: '18364758544493064720',
    });
    expect(decodeSigned(vector("64'hFFFFFFFFFFFFFFFE"))).toEqual({ status: 'ok', text: '-2' });
  });

  it('suppresses integer and enum interpretations when required bits are unknown', () => {
    const unknown = vector("8'b0011_XX01");

    expect(decodeUnsigned(unknown).status).toBe('unknown');
    expect(decodeSigned(unknown).status).toBe('unknown');
    expect(decodeEnum(unknown, { '0': 'IDLE' }).status).toBe('unknown');
  });

  it('decodes enums from decimal, hexadecimal, and HDL keys', () => {
    expect(decodeEnum(vector("4'h3"), { '0': 'IDLE', '0x3': 'RUNNING' }).text).toBe('RUNNING');
    expect(decodeEnum(vector("4'hA"), { "4'b1010": 'DONE' }).text).toBe('DONE');
    expect(decodeEnum(vector("4'hF"), { '0': 'IDLE' }).text).toBe('15 (unmapped)');
  });

  it('decodes IEEE-754 half, single, and double formats and rejects other widths', () => {
    expect(decodeFloat(vector("16'h3C00"))).toEqual({ status: 'ok', text: '1' });
    expect(decodeFloat(vector("16'hC000"))).toEqual({ status: 'ok', text: '-2' });
    expect(decodeFloat(vector("16'h7C00"))).toEqual({ status: 'ok', text: '+Infinity' });
    expect(decodeFloat(vector("32'h3F800000"))).toEqual({ status: 'ok', text: '1' });
    expect(decodeFloat(vector("64'h3FF0000000000000"))).toEqual({ status: 'ok', text: '1' });
    expect(decodeFloat(vector("8'h00")).status).toBe('error');
  });

  it('decodes signed Q-format exactly and validates the fractional-bit count', () => {
    expect(decodeFixedPoint(vector("8'hF4"), 4)).toEqual({ status: 'ok', text: '-0.75' });
    expect(decodeFixedPoint(vector("8'h18"), 4)).toEqual({ status: 'ok', text: '1.5' });
    expect(decodeFixedPoint(vector("8'h18"), 8).status).toBe('error');
    expect(decodeFixedPoint(vector("8'bX000_0000"), 4).status).toBe('unknown');
  });

  it('produces pass, fail, and unknown expected-value states', () => {
    expect(compareExpected(vector("8'hA5"), "8'hA5")).toBe('pass');
    expect(compareExpected(vector("8'hA5"), "8'hA4")).toBe('fail');
    expect(compareExpected(vector("8'bXXXX_0101"), "8'h05")).toBe('unknown');
    expect(compareExpected(vector("8'hA5"), "8'bXXXX_0101")).toBe('unknown');
  });
});
