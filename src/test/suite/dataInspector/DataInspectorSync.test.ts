import { act, renderHook } from '@testing-library/react';
import { createEmptyRecipe } from '../../../dataInspector/recipe';
import type { IPCraftDataInspectorRecipe } from '../../../domain/dataInspector.types';
import type {
  DataInspectorToExtensionMessage,
  DataInspectorToWebviewMessage,
} from '../../../shared/messages/dataInspector';
import { createRevisionState } from '../../../webview/sync/revisionFilter';
import { useDataInspectorSync } from '../../../webview/dataInspector/hooks/useDataInspectorSync';

function renderSync() {
  const postMessage = jest.fn<void, [DataInspectorToExtensionMessage]>();
  const revisionStateRef = { current: createRevisionState() };
  const setters = {
    setDraft: jest.fn(),
    setFieldProvenance: jest.fn(),
    setFields: jest.fn(),
    setFieldSourceIds: jest.fn(),
    setInspectedValueId: jest.fn(),
    setLaneWidth: jest.fn(),
    setLayouts: jest.fn(),
    setNextFieldNumber: jest.fn(),
    setRecipeBase: jest.fn(),
    setRecipeError: jest.fn(),
    setRecipeFileName: jest.fn(),
    setSamples: jest.fn(),
    setSelectedNodeId: jest.fn(),
    setSourceDrafts: jest.fn(),
    setSourceOriginalTexts: jest.fn(),
    setVector: jest.fn(),
    setWidthDraft: jest.fn(),
    setZoom: jest.fn(),
  };

  const view = renderHook(() =>
    useDataInspectorSync({ postMessage, revisionStateRef, ...setters })
  );

  const receive = (message: DataInspectorToWebviewMessage) => {
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: message }));
    });
  };

  return { ...view, postMessage, receive, revisionStateRef, setters };
}

function recipeMessage(
  recipe: IPCraftDataInspectorRecipe,
  docVersion: number
): DataInspectorToWebviewMessage {
  return { type: 'recipe', recipe, fileName: 'demo.di.yml', docVersion };
}

describe('useDataInspectorSync', () => {
  it('announces readiness and requests register layouts on mount', () => {
    const { postMessage } = renderSync();

    expect(postMessage.mock.calls.map(([message]) => message.type)).toEqual([
      'ready',
      'requestRegisterLayouts',
    ]);
  });

  it('seeds the value composer from the first recipe only', () => {
    const { receive, setters } = renderSync();
    const recipe = createEmptyRecipe('sync');
    recipe.sources[0].width = 8;

    receive(recipeMessage(recipe, 1));

    expect(setters.setDraft).toHaveBeenCalledWith('0');
    expect(setters.setSourceDrafts).toHaveBeenCalledWith({ input: '0' });
    expect(setters.setSourceOriginalTexts).toHaveBeenCalledWith({ input: '0' });
    expect(setters.setVector.mock.calls[0][0].width).toBe(8);
    expect(setters.setRecipeFileName).toHaveBeenCalledWith('demo.di.yml');

    const reopened = createEmptyRecipe('sync');
    reopened.sources[0].width = 16;
    receive(recipeMessage(reopened, 2));

    // The second recipe still lands, but must not reset the user's decoded value.
    expect(setters.setRecipeBase).toHaveBeenCalledTimes(2);
    expect(setters.setDraft).toHaveBeenCalledTimes(1);
    expect(setters.setVector).toHaveBeenCalledTimes(1);
    expect(setters.setSourceDrafts).toHaveBeenCalledTimes(1);
  });

  it('drops recipe updates at or below the version already seen', () => {
    const { receive, revisionStateRef, setters } = renderSync();
    const recipe = createEmptyRecipe('sync');

    receive(recipeMessage(recipe, 4));
    expect(revisionStateRef.current.seenDocVersion).toBe(4);
    expect(setters.setRecipeBase).toHaveBeenCalledTimes(1);

    receive(recipeMessage(createEmptyRecipe('stale'), 3));
    receive(recipeMessage(createEmptyRecipe('replay'), 4));

    expect(setters.setRecipeBase).toHaveBeenCalledTimes(1);
    expect(revisionStateRef.current.seenDocVersion).toBe(4);
  });

  it('applies a forced resync even when the version looks stale', () => {
    const { receive, setters } = renderSync();

    receive(recipeMessage(createEmptyRecipe('sync'), 7));
    receive({
      type: 'recipe',
      recipe: createEmptyRecipe('forced'),
      fileName: 'demo.di.yml',
      docVersion: 2,
      forceResync: true,
    });

    expect(setters.setRecipeBase).toHaveBeenCalledTimes(2);
    expect(setters.setRecipeBase.mock.calls[1][0].name).toBe('forced');
  });

  it('clears the recipe error on a good recipe and reports parse failures', () => {
    const { receive, setters } = renderSync();

    receive(recipeMessage(createEmptyRecipe('sync'), 1));
    expect(setters.setRecipeError).toHaveBeenLastCalledWith('');

    receive({ type: 'recipeError', error: 'bad indentation' });
    expect(setters.setRecipeError).toHaveBeenLastCalledWith('bad indentation');
  });

  it('numbers new fields above the highest field-N id in the recipe', () => {
    const { receive, setters } = renderSync();
    const recipe = createEmptyRecipe('sync');
    recipe.fields.push({
      id: 'field-7',
      name: 'STATUS',
      sourceId: 'input',
      msb: 3,
      lsb: 0,
      groupId: 'default',
      display: { interpretation: 'hex' },
    });

    receive(recipeMessage(recipe, 1));

    const advance = setters.setNextFieldNumber.mock.calls[0][0] as (current: number) => number;
    expect(advance(1)).toBe(8);
    expect(advance(99)).toBe(99);
  });

  it('keeps the selected node when the recipe still contains it', () => {
    const { receive, setters } = renderSync();
    const recipe = createEmptyRecipe('sync');

    receive(recipeMessage(recipe, 1));

    const reselect = setters.setSelectedNodeId.mock.calls[0][0] as (current: string) => string;
    expect(reselect('input')).toBe('input');
    expect(reselect('deleted-step')).toBe('input');
  });

  it('rebuilds fields and provenance when the host applies a register layout', () => {
    const { receive, setters } = renderSync();

    receive({
      type: 'applyRegisterLayout',
      layout: {
        id: 'CTRL',
        label: 'CTRL',
        width: 16,
        fields: [{ id: 'field-1', name: 'ENABLE', msb: 0, lsb: 0, groupId: 'default' }],
        sourceFile: 'regs.mm.yml',
        registerName: 'CTRL',
      },
    });

    expect(setters.setWidthDraft).toHaveBeenCalledWith('16');
    expect(setters.setVector.mock.calls[0][0].width).toBe(16);
    expect(setters.setFieldSourceIds).toHaveBeenCalledWith({ 'field-1': 'input' });
    expect(setters.setFieldProvenance).toHaveBeenCalledWith({
      'field-1': { sourceFile: 'regs.mm.yml', registerName: 'CTRL' },
    });
  });

  it('stops handling host messages after unmount', () => {
    const { receive, setters, unmount } = renderSync();

    unmount();
    receive(recipeMessage(createEmptyRecipe('sync'), 1));

    expect(setters.setRecipeBase).not.toHaveBeenCalled();
  });
});
