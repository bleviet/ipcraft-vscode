import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Step } from '../../../domain/dataInspector.types';
import { evaluateRecipe } from '../../../dataInspector/evaluateRecipe';
import { parseLiteral } from '../../../dataInspector/parseLiteral';
import { createEmptyRecipe, validateRecipeSemantics } from '../../../dataInspector/recipe';
import { applyTransform, type TransformStep } from '../../../dataInspector/transforms';
import {
  isBinaryOperation,
  parameterDefaults,
  TRANSFORM_OPERATIONS,
  transformOperation,
  type RecipeStepType,
} from '../../../webview/dataInspector/transform/operations';
import {
  DATA_INSPECTOR_OPERATION_MIME,
  WorkbenchLibrary,
} from '../../../webview/dataInspector/WorkbenchLibrary';

const input = parseLiteral("16'h12A5").vector;
const signedInput = parseLiteral("16'h92A5").vector;
const operand = parseLiteral("16'h0F0F").vector;

const operatorCases: Array<{
  type: RecipeStepType;
  transform: TransformStep;
  step: Step;
  input?: typeof input;
  expected: string;
  droppedRanges: Array<{ msb: number; lsb: number }>;
  insertedRange?: { msb: number; lsb: number; state: '0' | 'sign' };
}> = [
  {
    type: 'concat',
    transform: { type: 'concat', low: operand },
    step: { id: 'result', type: 'concat', inputId: 'input', operandId: 'operand' },
    expected: "32'h12A50F0F",
    droppedRanges: [],
  },
  {
    type: 'slice',
    transform: { type: 'slice', msb: 11, lsb: 4 },
    step: { id: 'result', type: 'slice', inputId: 'input', msb: 11, lsb: 4 },
    expected: "8'h2A",
    droppedRanges: [
      { msb: 15, lsb: 12 },
      { msb: 3, lsb: 0 },
    ],
  },
  {
    type: 'and',
    transform: { type: 'and', operand },
    step: { id: 'result', type: 'and', inputId: 'input', operandId: 'operand' },
    expected: "16'h0205",
    droppedRanges: [],
  },
  {
    type: 'or',
    transform: { type: 'or', operand },
    step: { id: 'result', type: 'or', inputId: 'input', operandId: 'operand' },
    expected: "16'h1FAF",
    droppedRanges: [],
  },
  {
    type: 'xor',
    transform: { type: 'xor', operand },
    step: { id: 'result', type: 'xor', inputId: 'input', operandId: 'operand' },
    expected: "16'h1DAA",
    droppedRanges: [],
  },
  {
    type: 'not',
    transform: { type: 'not' },
    step: { id: 'result', type: 'not', inputId: 'input' },
    expected: "16'hED5A",
    droppedRanges: [],
  },
  {
    type: 'shiftLeft',
    transform: { type: 'shiftLeft', amount: 4 },
    step: { id: 'result', type: 'shiftLeft', inputId: 'input', amount: 4 },
    expected: "16'h2A50",
    droppedRanges: [{ msb: 15, lsb: 12 }],
    insertedRange: { msb: 3, lsb: 0, state: '0' },
  },
  {
    type: 'shiftRight',
    transform: { type: 'shiftRight', amount: 4 },
    step: { id: 'result', type: 'shiftRight', inputId: 'input', amount: 4 },
    expected: "16'h012A",
    droppedRanges: [{ msb: 3, lsb: 0 }],
    insertedRange: { msb: 15, lsb: 12, state: '0' },
  },
  {
    type: 'zeroExtend',
    transform: { type: 'zeroExtend', width: 24 },
    step: { id: 'result', type: 'zeroExtend', inputId: 'input', width: 24 },
    expected: "24'h0012A5",
    droppedRanges: [],
    insertedRange: { msb: 23, lsb: 16, state: '0' },
  },
  {
    type: 'signExtend',
    transform: { type: 'signExtend', width: 24 },
    step: { id: 'result', type: 'signExtend', inputId: 'input', width: 24 },
    input: signedInput,
    expected: "24'hFF92A5",
    droppedRanges: [],
    insertedRange: { msb: 23, lsb: 16, state: 'sign' },
  },
  {
    type: 'truncate',
    transform: { type: 'truncate', width: 8 },
    step: { id: 'result', type: 'truncate', inputId: 'input', width: 8 },
    expected: "8'hA5",
    droppedRanges: [{ msb: 15, lsb: 8 }],
  },
  {
    type: 'byteSwap',
    transform: { type: 'byteSwap' },
    step: { id: 'result', type: 'byteSwap', inputId: 'input' },
    expected: "16'hA512",
    droppedRanges: [],
  },
];

describe('Data Inspector operators', () => {
  it.each(operatorCases)('applies $type with its value and display metadata', (operator) => {
    const result = applyTransform(operator.input ?? input, operator.transform);

    expect(result.value.toLiteral()).toBe(operator.expected);
    expect(result.droppedRanges).toEqual(operator.droppedRanges);
    expect(result.insertedRange).toEqual(operator.insertedRange);
  });

  it('reports no dropped or inserted ranges for identity slice and shifts', () => {
    const slice = applyTransform(input, { type: 'slice', msb: 15, lsb: 0 });
    const shiftLeft = applyTransform(input, { type: 'shiftLeft', amount: 0 });
    const shiftRight = applyTransform(input, { type: 'shiftRight', amount: 0 });

    expect(slice).toEqual({ value: input, droppedRanges: [] });
    for (const result of [shiftLeft, shiftRight]) {
      expect(result.value).toEqual(input);
      expect(result.droppedRanges).toEqual([]);
      expect(result.insertedRange).toBeUndefined();
    }
  });

  it.each(operatorCases)('evaluates $type through a recipe with provenance', (operator) => {
    const recipe = createEmptyRecipe(operator.type);
    recipe.sources = [
      { id: 'input', name: 'INPUT', width: 16 },
      { id: 'operand', name: 'OPERAND', width: 16 },
    ];
    recipe.steps = [operator.step];

    const evaluation = evaluateRecipe(
      recipe,
      new Map([
        ['input', operator.input ?? input],
        ['operand', operand],
      ])
    );
    const result = evaluation.values.get('result');

    expect(result?.value.toLiteral()).toBe(operator.expected);
    expect(evaluation.steps[0]).toMatchObject({
      id: 'result',
      inputWidth: 16,
      outputWidth: result?.value.width,
    });
    expect(evaluation.steps[0].error).toBeUndefined();
    expect(result?.provenance).toHaveLength(result?.value.width ?? 0);
    expect(evaluation.steps[0].transform?.droppedRanges).toEqual(operator.droppedRanges);
    expect(evaluation.steps[0].transform?.insertedRange).toEqual(operator.insertedRange);
  });

  it('keeps every available operator schema-valid and semantically valid', () => {
    for (const operator of operatorCases) {
      const recipe = createEmptyRecipe(operator.type);
      recipe.sources = [
        { id: 'input', name: 'INPUT', width: 16 },
        { id: 'operand', name: 'OPERAND', width: 16 },
      ];
      recipe.steps = [operator.step];

      expect(validateRecipeSemantics(recipe)).toEqual([]);
    }
  });

  it.each([
    ['concat', { id: 'result', type: 'concat', inputId: 'input' }, 'requires operandId'],
    ['slice', { id: 'result', type: 'slice', inputId: 'input', msb: 2 }, 'requires lsb'],
    ['and', { id: 'result', type: 'and', inputId: 'input', operandId: 'narrow' }, 'equal widths'],
    ['or', { id: 'result', type: 'or', inputId: 'input', operandId: 'narrow' }, 'equal widths'],
    ['xor', { id: 'result', type: 'xor', inputId: 'input', operandId: 'narrow' }, 'equal widths'],
    ['shiftLeft', { id: 'result', type: 'shiftLeft', inputId: 'input' }, 'requires amount'],
    ['shiftRight', { id: 'result', type: 'shiftRight', inputId: 'input' }, 'requires amount'],
    [
      'zeroExtend',
      { id: 'result', type: 'zeroExtend', inputId: 'input', width: 16 },
      'greater than',
    ],
    [
      'signExtend',
      { id: 'result', type: 'signExtend', inputId: 'input', width: 16 },
      'greater than',
    ],
    ['truncate', { id: 'result', type: 'truncate', inputId: 'input', width: 16 }, 'below'],
    ['byteSwap', { id: 'result', type: 'byteSwap', inputId: 'narrow' }, 'whole number of bytes'],
  ] as Array<[string, Step, string]>)('rejects invalid %s parameters', (_, step, error) => {
    const recipe = createEmptyRecipe('invalid operator');
    recipe.sources[0].width = 16;
    recipe.sources.push({ id: 'narrow', name: 'NARROW', width: 7 });
    recipe.steps = [step];

    expect(validateRecipeSemantics(recipe)).toEqual(
      expect.arrayContaining([expect.stringContaining(error)])
    );
  });

  it('keeps the operation registry, binary ports, and defaults complete', () => {
    expect(TRANSFORM_OPERATIONS.map((operation) => operation.type)).toEqual(
      operatorCases.map((operator) => operator.type)
    );
    expect(TRANSFORM_OPERATIONS.map((operation) => transformOperation(operation.type))).toEqual(
      TRANSFORM_OPERATIONS
    );
    expect(TRANSFORM_OPERATIONS.filter((operation) => isBinaryOperation(operation.type))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'concat' }),
        expect.objectContaining({ type: 'and' }),
        expect.objectContaining({ type: 'or' }),
        expect.objectContaining({ type: 'xor' }),
      ])
    );
    expect(
      TRANSFORM_OPERATIONS.filter((operation) => isBinaryOperation(operation.type))
    ).toHaveLength(4);
    expect(parameterDefaults('slice', 16)).toEqual({ msb: 15, lsb: 0 });
    expect(parameterDefaults('shiftLeft', 16)).toEqual({ amount: 1 });
    expect(parameterDefaults('shiftRight', 16)).toEqual({ amount: 1 });
    expect(parameterDefaults('zeroExtend', 16)).toEqual({ width: 17 });
    expect(parameterDefaults('signExtend', 16)).toEqual({ width: 17 });
    expect(parameterDefaults('truncate', 16)).toEqual({ width: 15 });
    expect(parameterDefaults('not', 16)).toEqual({});
  });

  it('exposes every operator as a clickable and draggable library action', () => {
    const onAddOperation = jest.fn();
    const dataTransfer = { effectAllowed: '', setData: jest.fn() };
    render(
      <WorkbenchLibrary
        collapsed={false}
        onToggleCollapsed={jest.fn()}
        onAddSource={jest.fn()}
        onAddOperation={onAddOperation}
      />
    );

    for (const operation of TRANSFORM_OPERATIONS) {
      const button = screen.getByRole('button', { name: `Add ${operation.label} draft` });
      fireEvent.click(button);
      fireEvent.dragStart(button, { dataTransfer });
    }

    expect(onAddOperation).toHaveBeenCalledTimes(TRANSFORM_OPERATIONS.length);
    TRANSFORM_OPERATIONS.forEach((operation, index) =>
      expect(onAddOperation).toHaveBeenNthCalledWith(index + 1, operation.type)
    );
    expect(dataTransfer.setData.mock.calls).toEqual(
      TRANSFORM_OPERATIONS.map((operation) => [DATA_INSPECTOR_OPERATION_MIME, operation.type])
    );
  });
});
