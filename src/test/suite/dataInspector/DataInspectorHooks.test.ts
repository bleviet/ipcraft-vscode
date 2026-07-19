import { act, renderHook } from '@testing-library/react';
import { BitVector } from '../../../dataInspector/BitVector';
import { createEmptyRecipe } from '../../../dataInspector/recipe';
import { createRevisionState } from '../../../webview/sync/revisionFilter';
import { useCaptureImport } from '../../../webview/dataInspector/hooks/useCaptureImport';
import { useFieldPanel } from '../../../webview/dataInspector/hooks/useFieldPanel';
import { useRecipeAutosave } from '../../../webview/dataInspector/hooks/useRecipeAutosave';
import { useValueInput } from '../../../webview/dataInspector/hooks/useValueInput';

describe('Data Inspector hooks', () => {
  it('keeps literal parsing, formatting, and original source text together', () => {
    const { result } = renderHook(() => useValueInput('input'));

    act(() => {
      expect(result.current.parseValue("8'hA5", '')).toBe(true);
    });
    expect(result.current.vector?.toBinary()).toBe('10100101');
    expect(result.current.draft).toBe('0xA5');
    expect(result.current.widthDraft).toBe('8');
    expect(result.current.sourceOriginalTexts.input).toBe("8'hA5");

    act(() => result.current.changeValueRepresentation('binary'));
    expect(result.current.draft).toBe('0b10100101');

    act(() => {
      expect(result.current.parseValue('not-a-literal')).toBe(false);
    });
    expect(result.current.error).not.toBe('');
    expect(result.current.vector?.toBinary()).toBe('10100101');
  });

  it('allocates and removes fields without colliding with recipe IDs', () => {
    const recipe = createEmptyRecipe('fields');
    recipe.sources[0].width = 8;
    recipe.fields.push({
      id: 'field-1',
      name: 'EXISTING',
      sourceId: 'input',
      msb: 7,
      lsb: 7,
      groupId: 'default',
      display: { interpretation: 'hex' },
    });
    const setError = jest.fn();
    const showFields = jest.fn();
    const { result } = renderHook(() => useFieldPanel());

    act(() =>
      result.current.addField({
        activeSource: recipe.sources[0],
        activeSourceFields: [],
        activeSourceVector: BitVector.fromBigInt(BigInt(0), 8),
        currentRecipe: recipe,
        setError,
        showFields,
      })
    );

    expect(result.current.fields).toEqual([
      { id: 'field-2', name: 'FIELD_2', msb: 7, lsb: 7, groupId: 'default' },
    ]);
    expect(result.current.fieldSourceIds).toEqual({ 'field-2': 'input' });
    expect(showFields).toHaveBeenCalledTimes(1);

    act(() => result.current.removeField('field-2'));
    expect(result.current.fields).toEqual([]);
    expect(result.current.fieldAnnouncement).toBe('Removed field FIELD_2');
  });

  it('owns CSV mapping and sample application as one capture concern', () => {
    const recipe = createEmptyRecipe('capture');
    const setSamples = jest.fn();
    const setVector = jest.fn();
    const setError = jest.fn();
    const { result } = renderHook(() =>
      useCaptureImport({
        activeSource: recipe.sources[0],
        currentRecipe: recipe,
        setError,
        setRecipeBase: jest.fn(),
        setSamples,
        setVector,
        setWidthDraft: jest.fn(),
      })
    );

    act(() => result.current.loadCsvText('INPUT\n0000002A'));
    expect(result.current.csvHeaders).toEqual(['INPUT']);
    expect(result.current.csvColumn).toBe('INPUT');

    act(() => result.current.importCsvSamples());
    expect(result.current.csvCapture?.samples).toHaveLength(1);
    expect(setSamples).toHaveBeenCalledTimes(1);
    const importedVector = setVector.mock.calls[0][0] as BitVector;
    expect(importedVector.toBigInt()).toBe(BigInt(42));
    expect(setError).toHaveBeenLastCalledWith('');
  });

  it('autosaves only valid loaded recipes and advances edit revisions', () => {
    jest.useFakeTimers();
    const recipe = createEmptyRecipe('autosave');
    const postMessage = jest.fn();
    const revisionStateRef = { current: createRevisionState() };
    const { rerender } = renderHook(
      ({ semanticProblemCount }) =>
        useRecipeAutosave({
          currentRecipe: recipe,
          enabled: true,
          postMessage,
          revisionStateRef,
          semanticProblemCount,
        }),
      { initialProps: { semanticProblemCount: 1 } }
    );

    act(() => jest.advanceTimersByTime(120));
    expect(postMessage).not.toHaveBeenCalled();

    rerender({ semanticProblemCount: 0 });
    act(() => jest.advanceTimersByTime(120));
    expect(postMessage).toHaveBeenCalledWith({
      type: 'updateRecipe',
      recipe,
      editId: 1,
    });
    jest.useRealTimers();
  });
});
