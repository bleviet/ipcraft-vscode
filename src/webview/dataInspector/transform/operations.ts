import type { Step } from '../../../domain/dataInspector.types';

export type RecipeStepType = Step['type'];

export interface TransformOperation {
  type: RecipeStepType;
  symbol: string;
  label: string;
  description: string;
}

export const TRANSFORM_OPERATIONS: readonly TransformOperation[] = [
  { type: 'concat', symbol: '{ }', label: 'Concat', description: 'Join two values' },
  { type: 'slice', symbol: '[ ]', label: 'Slice', description: 'Select a bit range' },
  { type: 'and', symbol: '&', label: 'AND', description: 'Bitwise AND' },
  { type: 'or', symbol: '|', label: 'OR', description: 'Bitwise OR' },
  { type: 'xor', symbol: '^', label: 'XOR', description: 'Bitwise XOR' },
  { type: 'not', symbol: '~', label: 'NOT', description: 'Invert every bit' },
  { type: 'shiftLeft', symbol: '<<', label: 'Shift left', description: 'Shift toward the MSB' },
  { type: 'shiftRight', symbol: '>>', label: 'Shift right', description: 'Shift toward the LSB' },
  { type: 'zeroExtend', symbol: '0+', label: 'Zero extend', description: 'Pad with zeroes' },
  { type: 'signExtend', symbol: 'S+', label: 'Sign extend', description: 'Repeat the sign bit' },
  { type: 'truncate', symbol: '[:]', label: 'Truncate', description: 'Reduce the bit width' },
  { type: 'byteSwap', symbol: 'B<>', label: 'Byte swap', description: 'Reverse byte order' },
];

export function transformOperation(type: RecipeStepType): TransformOperation {
  return TRANSFORM_OPERATIONS.find((operation) => operation.type === type)!;
}

export function isBinaryOperation(type: RecipeStepType): boolean {
  return ['concat', 'and', 'or', 'xor'].includes(type);
}

export function parameterDefaults(type: RecipeStepType, inputWidth: number): Partial<Step> {
  if (type === 'slice') {
    return { msb: Math.max(0, inputWidth - 1), lsb: 0 };
  }
  if (type === 'shiftLeft' || type === 'shiftRight') {
    return { amount: 1 };
  }
  if (type === 'zeroExtend' || type === 'signExtend') {
    return { width: Math.min(4096, inputWidth + 1) };
  }
  if (type === 'truncate') {
    return { width: Math.max(1, inputWidth - 1) };
  }
  return {};
}
