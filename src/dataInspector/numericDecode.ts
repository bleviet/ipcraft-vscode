import { BitVector } from './BitVector';
import { parseLiteral } from './parseLiteral';

export type DecodeStatus = 'ok' | 'unknown' | 'error';

export interface NumericDecodeResult {
  status: DecodeStatus;
  text: string;
}

function unknownResult(): NumericDecodeResult {
  return { status: 'unknown', text: '-- (unknown bits)' };
}

function knownValue(vector: BitVector): bigint | null {
  return vector.toBigInt();
}

export function decodeUnsigned(vector: BitVector): NumericDecodeResult {
  const value = knownValue(vector);
  return value === null ? unknownResult() : { status: 'ok', text: value.toString(10) };
}

export function signedBigInt(vector: BitVector): bigint | null {
  const value = knownValue(vector);
  if (value === null) {
    return null;
  }
  return vector.bit(vector.width - 1) === 1 ? value - (BigInt(1) << BigInt(vector.width)) : value;
}

export function decodeSigned(vector: BitVector): NumericDecodeResult {
  const value = signedBigInt(vector);
  return value === null ? unknownResult() : { status: 'ok', text: value.toString(10) };
}

function enumKeyValue(key: string, width: number): bigint | null {
  try {
    if (/^0[xX][0-9a-fA-F_]+$/.test(key)) {
      return BigInt(key.replace(/_/g, ''));
    }
    if (/^\d[\d_]*$/.test(key)) {
      return BigInt(key.replace(/_/g, ''));
    }
    return parseLiteral(key, { width }).vector.toBigInt();
  } catch {
    return null;
  }
}

export function decodeEnum(
  vector: BitVector,
  enumValues: Readonly<Record<string, string>>
): NumericDecodeResult {
  const value = knownValue(vector);
  if (value === null) {
    return unknownResult();
  }
  for (const [key, label] of Object.entries(enumValues)) {
    if (enumKeyValue(key, vector.width) === value) {
      return { status: 'ok', text: label };
    }
  }
  return { status: 'ok', text: `${value.toString(10)} (unmapped)` };
}

function formatFloat(value: number): string {
  if (Number.isNaN(value)) {
    return 'NaN';
  }
  if (value === Number.POSITIVE_INFINITY) {
    return '+Infinity';
  }
  if (value === Number.NEGATIVE_INFINITY) {
    return '-Infinity';
  }
  if (Object.is(value, -0)) {
    return '-0';
  }
  return String(value);
}

function decodeIeee(value: bigint, exponentBits: number, fractionBits: number): number {
  const sign = ((value >> BigInt(exponentBits + fractionBits)) & BigInt(1)) === BigInt(1) ? -1 : 1;
  const exponentMask = (BigInt(1) << BigInt(exponentBits)) - BigInt(1);
  const fractionMask = (BigInt(1) << BigInt(fractionBits)) - BigInt(1);
  const exponent = Number((value >> BigInt(fractionBits)) & exponentMask);
  const fraction = Number(value & fractionMask);
  const maxExponent = Number(exponentMask);
  if (exponent === maxExponent) {
    return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
  }
  if (exponent === 0) {
    return (
      sign *
      Math.pow(2, 1 - (Math.pow(2, exponentBits - 1) - 1)) *
      (fraction / Math.pow(2, fractionBits))
    );
  }
  const bias = Math.pow(2, exponentBits - 1) - 1;
  return sign * Math.pow(2, exponent - bias) * (1 + fraction / Math.pow(2, fractionBits));
}

export function decodeFloat(vector: BitVector): NumericDecodeResult {
  const layouts: Record<number, [number, number]> = { 16: [5, 10], 32: [8, 23], 64: [11, 52] };
  const layout = layouts[vector.width];
  if (!layout) {
    return { status: 'error', text: 'IEEE-754 requires a 16-, 32-, or 64-bit field' };
  }
  const value = knownValue(vector);
  if (value === null) {
    return unknownResult();
  }
  return { status: 'ok', text: formatFloat(decodeIeee(value, layout[0], layout[1])) };
}

function formatPowerOfTwoFraction(value: bigint, fractionalBits: number): string {
  if (fractionalBits === 0) {
    return value.toString(10);
  }
  const negative = value < BigInt(0);
  const magnitude = negative ? -value : value;
  const denominator = BigInt(1) << BigInt(fractionalBits);
  const integer = magnitude / denominator;
  const remainder = magnitude % denominator;
  if (remainder === BigInt(0)) {
    return `${negative ? '-' : ''}${integer.toString(10)}`;
  }
  let fivePower = BigInt(1);
  for (let index = 0; index < fractionalBits; index++) {
    fivePower *= BigInt(5);
  }
  const decimal = (remainder * fivePower)
    .toString(10)
    .padStart(fractionalBits, '0')
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${integer.toString(10)}.${decimal}`;
}

export function decodeFixedPoint(vector: BitVector, fractionalBits: number): NumericDecodeResult {
  if (!Number.isInteger(fractionalBits) || fractionalBits < 0 || fractionalBits >= vector.width) {
    return { status: 'error', text: `Fractional bits must be from 0 to ${vector.width - 1}` };
  }
  const value = signedBigInt(vector);
  return value === null
    ? unknownResult()
    : { status: 'ok', text: formatPowerOfTwoFraction(value, fractionalBits) };
}

export type ComparisonState = 'pass' | 'fail' | 'unknown';

export function compareExpected(vector: BitVector, expected: string): ComparisonState {
  if (vector.hasUnknown) {
    return 'unknown';
  }
  try {
    const expectedVector = parseLiteral(expected, { width: vector.width });
    return expectedVector.vector.hasUnknown
      ? 'unknown'
      : expectedVector.vector.equals(vector)
        ? 'pass'
        : 'fail';
  } catch {
    return 'fail';
  }
}
