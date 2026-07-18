import { BitVector } from './BitVector';

export type TransformStep =
  | { type: 'concat'; low: BitVector }
  | { type: 'slice'; msb: number; lsb: number }
  | { type: 'and'; operand: BitVector }
  | { type: 'or'; operand: BitVector }
  | { type: 'xor'; operand: BitVector }
  | { type: 'not' }
  | { type: 'shiftLeft'; amount: number }
  | { type: 'shiftRight'; amount: number }
  | { type: 'zeroExtend'; width: number }
  | { type: 'signExtend'; width: number }
  | { type: 'truncate'; width: number }
  | { type: 'byteSwap' };

export interface TransformResult {
  value: BitVector;
  droppedRanges: Array<{ msb: number; lsb: number }>;
  insertedRange?: { msb: number; lsb: number; state: '0' | 'sign' };
}

export function applyTransform(input: BitVector, step: TransformStep): TransformResult {
  switch (step.type) {
    case 'concat':
      return { value: input.concat(step.low), droppedRanges: [] };
    case 'slice':
      return {
        value: input.slice(step.msb, step.lsb),
        droppedRanges: [
          ...(step.msb < input.width - 1 ? [{ msb: input.width - 1, lsb: step.msb + 1 }] : []),
          ...(step.lsb > 0 ? [{ msb: step.lsb - 1, lsb: 0 }] : []),
        ],
      };
    case 'and':
      return { value: input.and(step.operand), droppedRanges: [] };
    case 'or':
      return { value: input.or(step.operand), droppedRanges: [] };
    case 'xor':
      return { value: input.xor(step.operand), droppedRanges: [] };
    case 'not':
      return { value: input.not(), droppedRanges: [] };
    case 'shiftLeft':
      return {
        value: input.shiftLeft(step.amount),
        droppedRanges:
          step.amount > 0
            ? [{ msb: input.width - 1, lsb: Math.max(0, input.width - step.amount) }]
            : [],
        insertedRange:
          step.amount > 0
            ? { msb: Math.min(input.width, step.amount) - 1, lsb: 0, state: '0' }
            : undefined,
      };
    case 'shiftRight':
      return {
        value: input.shiftRight(step.amount),
        droppedRanges:
          step.amount > 0 ? [{ msb: Math.min(input.width, step.amount) - 1, lsb: 0 }] : [],
        insertedRange:
          step.amount > 0
            ? {
                msb: input.width - 1,
                lsb: Math.max(0, input.width - step.amount),
                state: '0',
              }
            : undefined,
      };
    case 'zeroExtend':
      return {
        value: input.zeroExtend(step.width),
        droppedRanges: [],
        insertedRange: { msb: step.width - 1, lsb: input.width, state: '0' },
      };
    case 'signExtend':
      return {
        value: input.signExtend(step.width),
        droppedRanges: [],
        insertedRange: { msb: step.width - 1, lsb: input.width, state: 'sign' },
      };
    case 'truncate':
      return {
        value: input.truncate(step.width),
        droppedRanges: [{ msb: input.width - 1, lsb: step.width }],
      };
    case 'byteSwap':
      return { value: input.byteSwap(), droppedRanges: [] };
  }
}
