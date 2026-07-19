import {
  applyGraphEdit,
  recipeToGraph,
  stableTopologicalSteps,
  wouldCreateCycle,
} from '../../../dataInspector/recipeGraph';
import { createEmptyRecipe, validateRecipeSemantics } from '../../../dataInspector/recipe';

describe('recipe graph', () => {
  it('projects recipe references into stable graph edges', () => {
    const recipe = createEmptyRecipe('graph');
    recipe.sources.push({ id: 'mask', name: 'MASK', width: 32 });
    recipe.steps = [
      { id: 'masked', type: 'and', inputId: 'input', operandId: 'mask' },
      { id: 'shifted', type: 'shiftRight', inputId: 'masked', amount: 4 },
    ];
    expect(recipeToGraph(recipe).edges).toEqual([
      { id: 'masked.input', source: 'input', target: 'masked', targetHandle: 'input' },
      { id: 'masked.operand', source: 'mask', target: 'masked', targetHandle: 'operand' },
      { id: 'shifted.input', source: 'masked', target: 'shifted', targetHandle: 'input' },
    ]);
  });

  it('uses the previous order when several valid topological orders exist', () => {
    const steps = [
      { id: 'right', type: 'not' as const, inputId: 'input' },
      { id: 'left', type: 'not' as const, inputId: 'input' },
      { id: 'result', type: 'and' as const, inputId: 'left', operandId: 'right' },
    ];

    expect(stableTopologicalSteps(steps).map((step) => step.id)).toEqual([
      'right',
      'left',
      'result',
    ]);
  });

  it('rewires an edge and restores a valid step order', () => {
    const recipe = createEmptyRecipe('rewire');
    recipe.steps = [
      { id: 'consumer', type: 'not', inputId: 'input' },
      { id: 'producer', type: 'not', inputId: 'input' },
    ];

    const next = applyGraphEdit(recipe, {
      type: 'connect',
      sourceId: 'producer',
      targetId: 'consumer',
      targetHandle: 'input',
    });

    expect(next.steps.map((step) => step.id)).toEqual(['producer', 'consumer']);
    expect(next.steps[1].inputId).toBe('producer');
  });

  it('rejects a connection that would create a cycle', () => {
    const recipe = createEmptyRecipe('cycle');
    recipe.steps = [
      { id: 'first', type: 'not', inputId: 'input' },
      { id: 'second', type: 'not', inputId: 'first' },
    ];

    expect(wouldCreateCycle(recipe, 'second', 'first')).toBe(true);
    expect(() =>
      applyGraphEdit(recipe, {
        type: 'connect',
        sourceId: 'second',
        targetId: 'first',
        targetHandle: 'input',
      })
    ).toThrow('cycle');
  });

  it('deletes a used step and leaves its consumers disconnected', () => {
    const recipe = createEmptyRecipe('delete');
    recipe.steps = [
      { id: 'first', type: 'not', inputId: 'input' },
      { id: 'second', type: 'not', inputId: 'first' },
    ];
    const withoutFirst = applyGraphEdit(recipe, { type: 'deleteSteps', stepIds: ['first'] });

    expect(withoutFirst.steps).toEqual([{ id: 'second', type: 'not', inputId: 'first' }]);
    expect(recipeToGraph(withoutFirst).edges).toEqual([]);
    expect(validateRecipeSemantics(withoutFirst)).toEqual([]);

    const withoutSecond = applyGraphEdit(recipe, { type: 'deleteSteps', stepIds: ['second'] });

    expect(recipeToGraph(withoutSecond).edges).toEqual([
      { id: 'first.input', source: 'input', target: 'first', targetHandle: 'input' },
    ]);
    expect(validateRecipeSemantics(withoutSecond)).toEqual([]);
  });

  it('deletes a selected branch and its saved positions together', () => {
    const recipe = createEmptyRecipe('delete selection');
    recipe.steps = [
      { id: 'first', type: 'not', inputId: 'input' },
      { id: 'second', type: 'not', inputId: 'first' },
    ];
    recipe.view.canvas = {
      nodes: [
        { id: 'input', x: 0, y: 0 },
        { id: 'first', x: 1, y: 0 },
        { id: 'second', x: 2, y: 0 },
      ],
    };

    const next = applyGraphEdit(recipe, {
      type: 'deleteSteps',
      stepIds: ['first', 'second'],
    });

    expect(next.steps).toEqual([]);
    expect(next.view.canvas?.nodes).toEqual([{ id: 'input', x: 0, y: 0 }]);
  });

  it('deletes an unconnected input with its related field and view data', () => {
    const recipe = createEmptyRecipe('delete components');
    recipe.sources.push({ id: 'unused', name: 'UNUSED', width: 8 });
    recipe.fields.push({
      id: 'unusedField',
      name: 'UNUSED_FIELD',
      sourceId: 'unused',
      msb: 0,
      lsb: 0,
      groupId: 'default',
      display: { interpretation: 'hex' },
    });
    recipe.view.canvas = {
      nodes: [
        { id: 'input', x: 0, y: 0 },
        { id: 'unused', x: 0, y: 1 },
      ],
    };

    const next = applyGraphEdit(recipe, {
      type: 'deleteNodes',
      nodeIds: ['unused'],
    });

    expect(next.sources.map((source) => source.id)).toEqual(['input']);
    expect(next.fields).toEqual([]);
    expect(next.view.canvas?.nodes.map((node) => node.id)).toEqual(['input']);
  });

  it('keeps at least one input in the recipe', () => {
    const recipe = createEmptyRecipe('required components');

    expect(() => applyGraphEdit(recipe, { type: 'deleteNodes', nodeIds: ['input'] })).toThrow(
      'at least one input'
    );
  });
});
