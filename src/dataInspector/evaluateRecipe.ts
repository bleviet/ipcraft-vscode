import type { IPCraftDataInspectorRecipe, Step } from '../domain/dataInspector.types';
import { BitVector } from './BitVector';
import { applyTransform, type TransformResult, type TransformStep } from './transforms';

export interface ProvenanceBit {
  sourceId: string;
  sourceBit: number;
}

export interface EvaluatedValue {
  value: BitVector;
  provenance: Array<ProvenanceBit | null>;
  maskedBits: Set<number>;
}

export interface EvaluatedStep {
  id: string;
  inputWidth?: number;
  operandWidth?: number;
  outputWidth?: number;
  value?: EvaluatedValue;
  transform?: TransformResult;
  widthEquation?: string;
  error?: string;
}

export interface RecipeEvaluation {
  values: Map<string, EvaluatedValue>;
  steps: EvaluatedStep[];
}

function sourceValue(sourceId: string, value: BitVector): EvaluatedValue {
  return {
    value,
    provenance: Array.from({ length: value.width }, (_, sourceBit) => ({ sourceId, sourceBit })),
    maskedBits: new Set(),
  };
}

function unknownValue(width: number): EvaluatedValue {
  return {
    value: BitVector.filled(width, 'X'),
    provenance: Array<null>(width).fill(null),
    maskedBits: new Set(),
  };
}

function unknownOutputWidth(
  step: Step,
  inputWidth: number,
  operandWidth: number | undefined
): number {
  if (step.type === 'concat') {
    return inputWidth + (operandWidth ?? inputWidth);
  }
  if (step.type === 'slice' && step.msb !== undefined && step.lsb !== undefined) {
    return step.msb - step.lsb + 1;
  }
  if (['zeroExtend', 'signExtend', 'truncate'].includes(step.type) && step.width !== undefined) {
    return step.width;
  }
  return inputWidth;
}

function dependencyError(
  kind: 'Input' | 'Operand',
  id: string,
  sourceIds: ReadonlySet<string>,
  stepIds: ReadonlySet<string>
): string {
  if (sourceIds.has(id)) {
    return `${kind} ${id} has no sample`;
  }
  if (stepIds.has(id)) {
    return `${kind} ${id} is unavailable`;
  }
  return `${kind} ${id} is disconnected`;
}

function requireParameter<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function transformForStep(step: Step, operand: EvaluatedValue | undefined): TransformStep {
  switch (step.type) {
    case 'concat':
      return { type: 'concat', low: requireParameter(operand, 'operandId').value };
    case 'slice':
      return {
        type: 'slice',
        msb: requireParameter(step.msb, 'msb'),
        lsb: requireParameter(step.lsb, 'lsb'),
      };
    case 'and':
    case 'or':
    case 'xor':
      return { type: step.type, operand: requireParameter(operand, 'operandId').value };
    case 'not':
      return { type: 'not' };
    case 'shiftLeft':
    case 'shiftRight':
      return { type: step.type, amount: requireParameter(step.amount, 'amount') };
    case 'zeroExtend':
    case 'signExtend':
    case 'truncate':
      return { type: step.type, width: requireParameter(step.width, 'width') };
    case 'byteSwap':
      return { type: 'byteSwap' };
  }
}

function mapProvenance(
  step: Step,
  input: EvaluatedValue,
  operand: EvaluatedValue | undefined,
  outputWidth: number
): Array<ProvenanceBit | null> {
  switch (step.type) {
    case 'concat':
      return [...requireParameter(operand, 'operandId').provenance, ...input.provenance];
    case 'slice':
      return input.provenance.slice(
        requireParameter(step.lsb, 'lsb'),
        requireParameter(step.msb, 'msb') + 1
      );
    case 'shiftLeft': {
      const amount = Math.min(requireParameter(step.amount, 'amount'), input.value.width);
      return [
        ...Array<null>(amount).fill(null),
        ...input.provenance.slice(0, outputWidth - amount),
      ];
    }
    case 'shiftRight': {
      const amount = Math.min(requireParameter(step.amount, 'amount'), input.value.width);
      return [...input.provenance.slice(amount), ...Array<null>(amount).fill(null)];
    }
    case 'zeroExtend':
      return [...input.provenance, ...Array<null>(outputWidth - input.value.width).fill(null)];
    case 'signExtend':
      return [
        ...input.provenance,
        ...Array.from(
          { length: outputWidth - input.value.width },
          () => input.provenance[input.value.width - 1] ?? null
        ),
      ];
    case 'truncate':
      return input.provenance.slice(0, outputWidth);
    case 'byteSwap': {
      const bytes: Array<Array<ProvenanceBit | null>> = [];
      for (let bit = 0; bit < input.value.width; bit += 8) {
        bytes.push(input.provenance.slice(bit, bit + 8));
      }
      return bytes.reverse().flat();
    }
    default:
      return input.provenance.slice();
  }
}

function maskedBitsForStep(
  step: Step,
  input: EvaluatedValue,
  operand: EvaluatedValue | undefined
): Set<number> {
  const inputMask = Array.from({ length: input.value.width }, (_, bit) =>
    input.maskedBits.has(bit)
  );
  const operandMask = operand
    ? Array.from({ length: operand.value.width }, (_, bit) => operand.maskedBits.has(bit))
    : [];
  let outputMask: boolean[];
  switch (step.type) {
    case 'concat':
      outputMask = [...operandMask, ...inputMask];
      break;
    case 'slice':
      outputMask = inputMask.slice(
        requireParameter(step.lsb, 'lsb'),
        requireParameter(step.msb, 'msb') + 1
      );
      break;
    case 'shiftLeft': {
      const amount = Math.min(requireParameter(step.amount, 'amount'), input.value.width);
      outputMask = [
        ...Array<boolean>(amount).fill(false),
        ...inputMask.slice(0, -amount || undefined),
      ];
      break;
    }
    case 'shiftRight': {
      const amount = Math.min(requireParameter(step.amount, 'amount'), input.value.width);
      outputMask = [...inputMask.slice(amount), ...Array<boolean>(amount).fill(false)];
      break;
    }
    case 'zeroExtend':
      outputMask = [
        ...inputMask,
        ...Array<boolean>(requireParameter(step.width, 'width') - input.value.width).fill(false),
      ];
      break;
    case 'signExtend':
      outputMask = [
        ...inputMask,
        ...Array<boolean>(requireParameter(step.width, 'width') - input.value.width).fill(
          inputMask[input.value.width - 1] ?? false
        ),
      ];
      break;
    case 'truncate':
      outputMask = inputMask.slice(0, requireParameter(step.width, 'width'));
      break;
    case 'byteSwap': {
      const bytes: boolean[][] = [];
      for (let bit = 0; bit < inputMask.length; bit += 8) {
        bytes.push(inputMask.slice(bit, bit + 8));
      }
      outputMask = bytes.reverse().flat();
      break;
    }
    default:
      outputMask = inputMask.map((masked, bit) => masked || (operandMask[bit] ?? false));
  }
  const masked = new Set(outputMask.flatMap((isMasked, bit) => (isMasked ? [bit] : [])));
  if (step.type === 'and' && operand) {
    for (let bit = 0; bit < input.value.width; bit++) {
      if (operand.value.bit(bit) === 0) {
        masked.add(bit);
      }
    }
  }
  return masked;
}

function widthEquation(
  step: Step,
  inputWidth: number,
  operandWidth: number | undefined,
  outputWidth: number
): string {
  if (step.type === 'concat') {
    return `${inputWidth} + ${operandWidth ?? '?'} = ${outputWidth} bits`;
  }
  if (['zeroExtend', 'signExtend', 'truncate', 'slice'].includes(step.type)) {
    return `${inputWidth} → ${outputWidth} bits`;
  }
  return `${inputWidth} bits → ${outputWidth} bits`;
}

export function evaluateRecipe(
  recipe: IPCraftDataInspectorRecipe,
  samples: ReadonlyMap<string, BitVector>
): RecipeEvaluation {
  const values = new Map<string, EvaluatedValue>();
  const sourceIds = new Set(recipe.sources.map((source) => source.id));
  const stepIds = new Set(recipe.steps.map((step) => step.id));
  for (const source of recipe.sources) {
    const sample = samples.get(source.id);
    if (sample?.width === source.width) {
      values.set(source.id, sourceValue(source.id, sample));
    }
  }

  const steps: EvaluatedStep[] = [];
  for (const step of recipe.steps) {
    const input = values.get(step.inputId);
    const operand = step.operandId ? values.get(step.operandId) : undefined;
    if (!input || (step.operandId && !operand)) {
      const inputWidth =
        input?.value.width ?? operand?.value.width ?? recipe.sources[0]?.width ?? 1;
      const operandWidth = operand?.value.width ?? (step.operandId ? inputWidth : undefined);
      const outputWidth = unknownOutputWidth(step, inputWidth, operandWidth);
      const value = outputWidth <= 4096 ? unknownValue(outputWidth) : undefined;
      if (value) {
        values.set(step.id, value);
      }
      steps.push({
        id: step.id,
        inputWidth,
        operandWidth,
        outputWidth: value?.value.width,
        value,
        widthEquation: value
          ? widthEquation(step, inputWidth, operandWidth, value.value.width)
          : undefined,
        error: !input
          ? dependencyError('Input', step.inputId, sourceIds, stepIds)
          : dependencyError('Operand', step.operandId!, sourceIds, stepIds),
      });
      continue;
    }
    try {
      const transform = applyTransform(input.value, transformForStep(step, operand));
      const value: EvaluatedValue = {
        value: transform.value,
        provenance: mapProvenance(step, input, operand, transform.value.width),
        maskedBits: maskedBitsForStep(step, input, operand),
      };
      values.set(step.id, value);
      steps.push({
        id: step.id,
        inputWidth: input.value.width,
        operandWidth: operand?.value.width,
        outputWidth: value.value.width,
        value,
        transform,
        widthEquation: widthEquation(
          step,
          input.value.width,
          operand?.value.width,
          value.value.width
        ),
      });
    } catch (error) {
      steps.push({
        id: step.id,
        inputWidth: input.value.width,
        operandWidth: operand?.value.width,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { values, steps };
}
