import type { BitVector } from './BitVector';

export type ValueRepresentation = 'hex' | 'binary' | 'decimal';

export function formatValue(value: BitVector, representation: ValueRepresentation = 'hex'): string {
  if (representation === 'binary') {
    return `0b${value.toBinary()}`;
  }

  if (representation === 'decimal') {
    const decimal = value.toBigInt();
    return decimal === null ? `0b${value.toBinary()}` : decimal.toString(10);
  }

  const hex = value.toHex();
  return hex === null ? `0b${value.toBinary()}` : `0x${hex}`;
}
