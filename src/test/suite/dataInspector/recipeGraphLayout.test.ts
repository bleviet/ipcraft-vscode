import { recipeToGraph } from '../../../dataInspector/recipeGraph';
import { createEmptyRecipe } from '../../../dataInspector/recipe';
import {
  layoutRecipeGraph,
  resolveCanvasPositions,
} from '../../../webview/dataInspector/canvas/layout';

describe('recipe graph layout', () => {
  it('places dependencies in left-to-right layers with stable rows', () => {
    const recipe = createEmptyRecipe('layout');
    recipe.sources.push({ id: 'mask', name: 'MASK', width: 32 });
    recipe.steps = [
      { id: 'masked', type: 'and', inputId: 'input', operandId: 'mask' },
      { id: 'shifted', type: 'shiftRight', inputId: 'masked', amount: 2 },
    ];
    const positions = new Map(
      layoutRecipeGraph(recipeToGraph(recipe)).map((position) => [position.id, position])
    );

    expect(positions.get('input')?.x).toBe(positions.get('mask')?.x);
    expect(positions.get('masked')!.x).toBeGreaterThan(positions.get('input')!.x);
    expect(positions.get('shifted')!.x).toBeGreaterThan(positions.get('masked')!.x);
    expect(positions.get('mask')!.y).toBeGreaterThan(positions.get('input')!.y);
  });

  it('keeps saved positions and lays out new nodes', () => {
    const recipe = createEmptyRecipe('saved layout');
    recipe.steps = [{ id: 'inverted', type: 'not', inputId: 'input' }];
    const positions = resolveCanvasPositions(recipeToGraph(recipe), [
      { id: 'input', x: 900, y: 700 },
      { id: 'removed', x: 1, y: 2 },
    ]);

    expect(positions.find((position) => position.id === 'input')).toEqual({
      id: 'input',
      x: 900,
      y: 700,
    });
    expect(positions.some((position) => position.id === 'inverted')).toBe(true);
    expect(positions.some((position) => position.id === 'removed')).toBe(false);
  });
});
