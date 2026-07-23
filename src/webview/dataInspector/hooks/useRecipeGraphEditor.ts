import type { Dispatch, SetStateAction } from 'react';
import { formatValue } from '../../../dataInspector/formatValue';
import { parseLiteral } from '../../../dataInspector/parseLiteral';
import { applyGraphEdit } from '../../../dataInspector/recipeGraph';
import type { IPCraftDataInspectorRecipe } from '../../../domain/dataInspector.types';
import type { FieldPanelState } from './useFieldPanel';
import type { PanelLayoutState } from './usePanelLayout';
import type { RecipeModelState } from './useRecipeModel';
import type { ValueInputState } from './useValueInput';

interface RecipeGraphEditorOptions {
  fieldPanel: FieldPanelState;
  panelLayout: PanelLayoutState;
  recipeModel: RecipeModelState;
  setRecipeBase: Dispatch<SetStateAction<IPCraftDataInspectorRecipe | null>>;
  valueInput: ValueInputState;
}

export function useRecipeGraphEditor({
  fieldPanel,
  panelLayout,
  recipeModel,
  setRecipeBase,
  valueInput,
}: RecipeGraphEditorOptions) {
  const { currentRecipe } = recipeModel;
  const { setFieldProvenance, setFields, setFieldSourceIds, setSelectedFieldId } = fieldPanel;
  const { inspectedValueId, selectedNodeId, setInspectedValueId, setSelectedNodeId } = panelLayout;
  const {
    samples,
    setDraft,
    setError,
    setSamples,
    setSourceDrafts,
    setSourceOriginalTexts,
    setVector,
    setWarnings,
    setWidthDraft,
    sourceDrafts,
    valueRepresentation,
  } = valueInput;

  const selectedSource = currentRecipe.sources.find((source) => source.id === selectedNodeId);
  const selectedSourceIndex = selectedSource
    ? currentRecipe.sources.findIndex((source) => source.id === selectedSource.id)
    : -1;
  const selectedStep = currentRecipe.steps.find((step) => step.id === selectedNodeId);

  const deleteCanvasNodes = (nodeIds: string[]): string | undefined => {
    try {
      const candidate = applyGraphEdit(currentRecipe, { type: 'deleteNodes', nodeIds });
      const remainingNodeIds = new Set([
        ...candidate.sources.map((source) => source.id),
        ...candidate.steps.map((step) => step.id),
      ]);
      const remainingSourceIds = new Set(candidate.sources.map((source) => source.id));
      const remainingFieldIds = new Set(candidate.fields.map((field) => field.id));
      const fallbackSource = candidate.sources[0];

      setRecipeBase(candidate);
      setFields((current) => current.filter((field) => remainingFieldIds.has(field.id)));
      setFieldSourceIds((current) =>
        Object.fromEntries(
          Object.entries(current).filter(
            ([fieldId, sourceId]) =>
              remainingFieldIds.has(fieldId) && remainingSourceIds.has(sourceId)
          )
        )
      );
      setFieldProvenance((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([fieldId]) => remainingFieldIds.has(fieldId))
        )
      );
      setSamples((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([sourceId]) => remainingSourceIds.has(sourceId))
        )
      );
      setSourceDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([sourceId]) => remainingSourceIds.has(sourceId))
        )
      );
      setSourceOriginalTexts((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([sourceId]) => remainingSourceIds.has(sourceId))
        )
      );
      setSelectedFieldId((current) => (current && remainingFieldIds.has(current) ? current : null));

      if (!remainingNodeIds.has(selectedNodeId)) {
        setSelectedNodeId(fallbackSource.id);
      }
      if (inspectedValueId && !remainingNodeIds.has(inspectedValueId)) {
        setInspectedValueId(fallbackSource.id);
      }
      if (!remainingSourceIds.has(currentRecipe.sources[0].id)) {
        const nextVector = samples[fallbackSource.id] ?? null;
        setVector(nextVector);
        setWidthDraft(String(nextVector?.width ?? fallbackSource.width));
      }
      setError('');
      return undefined;
    } catch (deleteError) {
      return deleteError instanceof Error ? deleteError.message : String(deleteError);
    }
  };

  const updateSelectedFieldDisplay = (
    patch: Partial<IPCraftDataInspectorRecipe['fields'][number]['display']>
  ) => {
    if (!fieldPanel.selectedFieldId) {
      return;
    }
    setRecipeBase({
      ...currentRecipe,
      fields: currentRecipe.fields.map((field) =>
        field.id === fieldPanel.selectedFieldId
          ? { ...field, display: { ...field.display, ...patch } }
          : field
      ),
    });
  };

  const updateStep = (
    index: number,
    patch: Partial<IPCraftDataInspectorRecipe['steps'][number]>
  ) => {
    setRecipeBase({
      ...currentRecipe,
      steps: currentRecipe.steps.map((step, stepIndex) =>
        stepIndex === index ? { ...step, ...patch } : step
      ),
    });
  };

  const connectStepDependency = (
    stepId: string,
    targetHandle: 'input' | 'operand',
    sourceId: string
  ) => {
    try {
      setRecipeBase(
        applyGraphEdit(currentRecipe, { type: 'connect', sourceId, targetId: stepId, targetHandle })
      );
      setError('');
    } catch (connectionError) {
      setError(
        connectionError instanceof Error ? connectionError.message : String(connectionError)
      );
    }
  };

  const removeStep = (index: number) => {
    const removed = currentRecipe.steps[index];
    if (!removed) {
      return;
    }
    const fallbackId = removed.inputId;
    const steps = currentRecipe.steps
      .filter((_, stepIndex) => stepIndex !== index)
      .map((step) => ({
        ...step,
        inputId: step.inputId === removed.id ? fallbackId : step.inputId,
        ...(step.operandId === removed.id ? { operandId: fallbackId } : {}),
      }));
    setRecipeBase({ ...currentRecipe, steps });
  };

  const removeSelectedSource = () => {
    if (!selectedSource || currentRecipe.sources.length === 1) {
      return;
    }
    const referenced = currentRecipe.steps.some(
      (step) => step.inputId === selectedSource.id || step.operandId === selectedSource.id
    );
    if (referenced) {
      setError('Disconnect this input from all operators before deleting it');
      return;
    }
    const removedFieldIds = new Set(
      currentRecipe.fields
        .filter((field) => field.sourceId === selectedSource.id)
        .map((field) => field.id)
    );
    setRecipeBase({
      ...currentRecipe,
      sources: currentRecipe.sources.filter((source) => source.id !== selectedSource.id),
      fields: currentRecipe.fields.filter((field) => field.sourceId !== selectedSource.id),
    });
    setFields((current) => current.filter((field) => !removedFieldIds.has(field.id)));
    setSamples((current) => {
      const next = { ...current };
      delete next[selectedSource.id];
      return next;
    });
    setSourceOriginalTexts((current) => {
      const next = { ...current };
      delete next[selectedSource.id];
      return next;
    });
    setSelectedNodeId(currentRecipe.sources[0].id);
    setInspectedValueId(currentRecipe.sources[0].id);
    setError('');
  };

  const updateSelectedSource = (patch: Partial<IPCraftDataInspectorRecipe['sources'][number]>) => {
    if (!selectedSource) {
      return;
    }
    setRecipeBase({
      ...currentRecipe,
      sources: currentRecipe.sources.map((source) =>
        source.id === selectedSource.id ? { ...source, ...patch } : source
      ),
    });
    if (patch.width !== undefined && selectedSourceIndex === 0) {
      setWidthDraft(String(patch.width));
    }
  };

  const applySelectedSourceDraft = () => {
    if (!selectedSource) {
      return;
    }
    try {
      const parsed = parseLiteral(sourceDrafts[selectedSource.id] ?? '', {
        width: selectedSource.width,
      });
      setSamples((current) => ({ ...current, [selectedSource.id]: parsed.vector }));
      const normalizedText = formatValue(parsed.vector, valueRepresentation);
      setSourceDrafts((current) => ({ ...current, [selectedSource.id]: normalizedText }));
      setSourceOriginalTexts((current) => ({
        ...current,
        [selectedSource.id]: parsed.originalText,
      }));
      if (selectedSourceIndex === 0) {
        setVector(parsed.vector);
        setDraft(normalizedText);
        setWarnings(parsed.warnings);
      }
      setError('');
    } catch (sourceError) {
      setError(sourceError instanceof Error ? sourceError.message : String(sourceError));
    }
  };

  return {
    applySelectedSourceDraft,
    connectStepDependency,
    deleteCanvasNodes,
    removeSelectedSource,
    removeStep,
    selectedSource,
    selectedSourceIndex,
    selectedStep,
    updateSelectedFieldDisplay,
    updateSelectedSource,
    updateStep,
  };
}

export type RecipeGraphEditorState = ReturnType<typeof useRecipeGraphEditor>;
