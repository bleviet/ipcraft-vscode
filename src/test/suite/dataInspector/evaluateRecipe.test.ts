import { evaluateRecipe } from '../../../dataInspector/evaluateRecipe';
import { parseLiteral } from '../../../dataInspector/parseLiteral';
import { createEmptyRecipe } from '../../../dataInspector/recipe';

describe('evaluateRecipe', () => {
  it('evaluates ordered concat with explicit high and low operands and provenance', () => {
    const recipe = createEmptyRecipe('concat');
    recipe.sources = [
      { id: 'a', name: 'A', width: 8 },
      { id: 'b', name: 'B', width: 8 },
    ];
    recipe.steps = [{ id: 'ab', type: 'concat', inputId: 'a', operandId: 'b' }];
    recipe.outputs = [{ id: 'result', name: 'RESULT', valueId: 'ab' }];
    const evaluation = evaluateRecipe(
      recipe,
      new Map([
        ['a', parseLiteral("8'h12").vector],
        ['b', parseLiteral("8'h34").vector],
      ])
    );
    const result = evaluation.values.get('ab');

    expect(result?.value.toLiteral()).toBe("16'h1234");
    expect(evaluation.steps[0].widthEquation).toBe('8 + 8 = 16 bits');
    expect(result?.provenance[0]).toEqual({ sourceId: 'b', sourceBit: 0 });
    expect(result?.provenance[15]).toEqual({ sourceId: 'a', sourceBit: 7 });

    recipe.steps = [{ id: 'ba', type: 'concat', inputId: 'b', operandId: 'a' }];
    expect(
      evaluateRecipe(
        recipe,
        new Map([
          ['a', parseLiteral("8'h12").vector],
          ['b', parseLiteral("8'h34").vector],
        ])
      )
        .values.get('ba')
        ?.value.toLiteral()
    ).toBe("16'h3412");
  });

  it('marks masked bits without removing them from the value or provenance', () => {
    const recipe = createEmptyRecipe('mask');
    recipe.sources = [
      { id: 'input', name: 'INPUT', width: 8 },
      { id: 'mask', name: 'MASK', width: 8 },
    ];
    recipe.steps = [{ id: 'masked', type: 'and', inputId: 'input', operandId: 'mask' }];
    const result = evaluateRecipe(
      recipe,
      new Map([
        ['input', parseLiteral("8'hFF").vector],
        ['mask', parseLiteral("8'h0F").vector],
      ])
    ).values.get('masked');

    expect(result?.value.toLiteral()).toBe("8'h0F");
    expect([...(result?.maskedBits ?? [])]).toEqual([4, 5, 6, 7]);
    expect(result?.provenance).toHaveLength(8);
  });

  it('moves masked-bit metadata through concat and byte swap', () => {
    const recipe = createEmptyRecipe('mask movement');
    recipe.sources = [
      { id: 'input', name: 'INPUT', width: 8 },
      { id: 'mask', name: 'MASK', width: 8 },
      { id: 'low', name: 'LOW', width: 8 },
    ];
    recipe.steps = [
      { id: 'masked', type: 'and', inputId: 'input', operandId: 'mask' },
      { id: 'combined', type: 'concat', inputId: 'masked', operandId: 'low' },
      { id: 'swapped', type: 'byteSwap', inputId: 'combined' },
    ];
    const result = evaluateRecipe(
      recipe,
      new Map([
        ['input', parseLiteral("8'hFF").vector],
        ['mask', parseLiteral("8'h0F").vector],
        ['low', parseLiteral("8'hAA").vector],
      ])
    ).values.get('swapped');

    expect([...(result?.maskedBits ?? [])]).toEqual([4, 5, 6, 7]);
  });

  it('reports dropped ranges and makes downstream dependencies unavailable', () => {
    const recipe = createEmptyRecipe('errors');
    recipe.sources = [{ id: 'input', name: 'INPUT', width: 8 }];
    recipe.steps = [
      { id: 'slice', type: 'slice', inputId: 'input', msb: 5, lsb: 2 },
      { id: 'invalid', type: 'and', inputId: 'slice', operandId: 'missing' },
      { id: 'downstream', type: 'not', inputId: 'invalid' },
    ];
    const evaluation = evaluateRecipe(recipe, new Map([['input', parseLiteral("8'hA5").vector]]));

    expect(evaluation.steps[0].transform?.droppedRanges).toEqual([
      { msb: 7, lsb: 6 },
      { msb: 1, lsb: 0 },
    ]);
    expect(evaluation.steps[1].error).toBe('Operand missing is unavailable');
    expect(evaluation.steps[2].error).toBe('Input invalid is unavailable');
    expect(evaluation.values.has('downstream')).toBe(false);
  });
});
