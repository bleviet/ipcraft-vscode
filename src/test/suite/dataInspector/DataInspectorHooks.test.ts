import { useState } from 'react';
import { act, renderHook } from '@testing-library/react';
import { BitVector } from '../../../dataInspector/BitVector';
import { createEmptyRecipe } from '../../../dataInspector/recipe';
import { createRevisionState } from '../../../webview/sync/revisionFilter';
import { useCaptureImport } from '../../../webview/dataInspector/hooks/useCaptureImport';
import { useFieldPanel } from '../../../webview/dataInspector/hooks/useFieldPanel';
import { useRecipeAutosave } from '../../../webview/dataInspector/hooks/useRecipeAutosave';
import { useRecipeGraphEditor } from '../../../webview/dataInspector/hooks/useRecipeGraphEditor';
import { useRecipeModel } from '../../../webview/dataInspector/hooks/useRecipeModel';
import { usePanelLayout } from '../../../webview/dataInspector/hooks/usePanelLayout';
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

  it('derives recipe execution and reconciles source samples in one model', () => {
    const recipe = createEmptyRecipe('model');
    recipe.sources.push({ id: 'operand', name: 'OPERAND', width: 8 });
    const { result } = renderHook(() => {
      const valueInput = useValueInput('input');
      const fieldPanel = useFieldPanel();
      const panelLayout = usePanelLayout(valueInput.vector);
      const recipeModel = useRecipeModel({
        recipeBase: recipe,
        fieldPanel,
        panelLayout,
        valueInput,
      });
      return { recipeModel, valueInput };
    });

    expect(result.current.valueInput.sourceDrafts.operand).toBe('0');
    expect(result.current.valueInput.samples.operand.width).toBe(8);
    expect(result.current.recipeModel.currentRecipe.sources).toHaveLength(2);
    expect(result.current.recipeModel.evaluation.values.get('operand')?.value.width).toBe(8);
    expect(result.current.recipeModel.recipeSemanticProblems).toEqual([]);
  });

  it('owns graph edits and their dependent state cleanup', () => {
    const initialRecipe = createEmptyRecipe('graph');
    initialRecipe.sources.push({ id: 'operand', name: 'OPERAND', width: 32 });
    initialRecipe.steps.push({ id: 'invert', type: 'not', inputId: 'input' });
    const { result } = renderHook(() => {
      const [recipeBase, setRecipeBase] = useState<typeof initialRecipe | null>(initialRecipe);
      const valueInput = useValueInput('input');
      const fieldPanel = useFieldPanel();
      const panelLayout = usePanelLayout(valueInput.vector);
      const recipeModel = useRecipeModel({
        recipeBase,
        fieldPanel,
        panelLayout,
        valueInput,
      });
      const graphEditor = useRecipeGraphEditor({
        fieldPanel,
        panelLayout,
        recipeModel,
        setRecipeBase,
        valueInput,
      });
      return { graphEditor, panelLayout, recipeModel, valueInput };
    });

    act(() => result.current.panelLayout.setSelectedNodeId('operand'));
    expect(result.current.graphEditor.selectedSource?.id).toBe('operand');

    act(() => result.current.graphEditor.updateSelectedSource({ name: 'MASK' }));
    expect(result.current.recipeModel.currentRecipe.sources[1].name).toBe('MASK');

    act(() => result.current.graphEditor.connectStepDependency('invert', 'input', 'invert'));
    expect(result.current.valueInput.error).toBe('This connection would create a cycle');

    act(() => {
      result.current.valueInput.setSourceDrafts((current) => ({
        ...current,
        operand: 'not-a-literal',
      }));
    });
    act(() => result.current.graphEditor.applySelectedSourceDraft());
    expect(result.current.valueInput.error).not.toBe('');

    act(() => result.current.graphEditor.updateStep(0, { inputId: 'operand' }));
    expect(result.current.recipeModel.currentRecipe.steps[0].inputId).toBe('operand');

    act(() => result.current.graphEditor.removeStep(0));
    expect(result.current.recipeModel.currentRecipe.steps).toEqual([]);

    act(() => result.current.graphEditor.removeSelectedSource());
    expect(result.current.recipeModel.currentRecipe.sources.map((source) => source.id)).toEqual([
      'input',
    ]);
    expect(result.current.panelLayout.selectedNodeId).toBe('input');

    let deleteError: string | undefined;
    act(() => {
      deleteError = result.current.graphEditor.deleteCanvasNodes(['input']);
    });
    expect(deleteError).toBe('A recipe must keep at least one input');
  });

  it('keeps panel navigation and queued canvas commands together', () => {
    const { result, rerender } = renderHook(
      ({ vector }: { vector: BitVector | null }) => usePanelLayout(vector),
      { initialProps: { vector: null as BitVector | null } }
    );

    expect(result.current.mobileTab).toBe('value');
    rerender({ vector: BitVector.fromBigInt(BigInt(0), 8) });
    expect(result.current.mobileTab).toBe('bits');

    act(() => {
      result.current.queueCanvasAdd('operation', 'slice');
      result.current.queueCanvasAdd('source', 'source');
    });
    expect(result.current.canvasAddCommand).toEqual({ id: 2, kind: 'source', value: 'source' });
    expect(result.current.mobileTab).toBe('transform');
  });

  it('clamps pointer-driven panel and center resizing to their supported bounds', () => {
    const { result } = renderHook(() => usePanelLayout(BitVector.fromBigInt(BigInt(0), 8)));
    (result.current.centerRef as { current: HTMLDivElement | null }).current = {
      getBoundingClientRect: () => ({ top: 100, height: 100 }),
    } as HTMLDivElement;

    act(() => {
      result.current.beginCenterResize({
        currentTarget: { setPointerCapture: jest.fn() },
        pointerId: 1,
      } as unknown as Parameters<typeof result.current.beginCenterResize>[0]);
      window.dispatchEvent(new MouseEvent('pointermove', { clientY: 1000 }));
      window.dispatchEvent(new MouseEvent('pointerup'));
    });
    expect(result.current.bitsPercent).toBe(72);

    act(() => {
      result.current.beginPanelResize(
        {
          clientX: 0,
          currentTarget: { setPointerCapture: jest.fn() },
          pointerId: 2,
          preventDefault: jest.fn(),
        } as unknown as Parameters<typeof result.current.beginPanelResize>[0],
        'library'
      );
      window.dispatchEvent(new MouseEvent('pointermove', { clientX: 1000 }));
      window.dispatchEvent(new MouseEvent('pointerup'));
    });
    expect(result.current.libraryPanelWidth).toBe(420);
  });
});
