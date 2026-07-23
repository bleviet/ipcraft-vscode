import { useEffect, useMemo } from 'react';
import { evaluateRecipe } from '../../../dataInspector/evaluateRecipe';
import { projectFieldsToOutput } from '../../../dataInspector/fieldLayout';
import { parseLiteral } from '../../../dataInspector/parseLiteral';
import { createEmptyRecipe, validateRecipeSemantics } from '../../../dataInspector/recipe';
import type { IPCraftDataInspectorRecipe } from '../../../domain/dataInspector.types';
import type { FieldPanelState } from './useFieldPanel';
import type { PanelLayoutState } from './usePanelLayout';
import type { ValueInputState } from './useValueInput';

interface RecipeModelOptions {
  recipeBase: IPCraftDataInspectorRecipe | null;
  fieldPanel: FieldPanelState;
  panelLayout: PanelLayoutState;
  valueInput: ValueInputState;
}

export function useRecipeModel({
  recipeBase,
  fieldPanel,
  panelLayout,
  valueInput,
}: RecipeModelOptions) {
  const { fieldProvenance, fields, fieldSourceIds } = fieldPanel;
  const { laneWidth, zoom } = panelLayout;
  const { samples, setSamples, setSourceDrafts, sourceDrafts, vector, widthDraft } = valueInput;

  const currentRecipe = useMemo<IPCraftDataInspectorRecipe>(() => {
    const draftWidth = widthDraft === '' ? vector?.width : Number(widthDraft);
    const width = draftWidth ?? recipeBase?.sources[0]?.width ?? 32;
    const base = recipeBase ?? createEmptyRecipe('data-inspector');
    const sourceId = base.sources[0]?.id ?? 'input';
    const existingFields = new Map(base.fields.map((field) => [field.id, field]));
    return {
      ...base,
      sources:
        base.sources.length > 0
          ? base.sources.map((source, index) => (index === 0 ? { ...source, width } : source))
          : [{ id: sourceId, name: 'INPUT', width }],
      fields: fields.map((field) => {
        const existing = existingFields.get(field.id);
        return {
          ...field,
          sourceId: fieldSourceIds[field.id] ?? existing?.sourceId ?? sourceId,
          display: existing?.display ?? { interpretation: 'hex' as const },
          importProvenance: fieldProvenance[field.id] ?? existing?.importProvenance,
        };
      }),
      view: { ...base.view, laneWidth, zoom },
    };
  }, [
    fieldProvenance,
    fields,
    fieldSourceIds,
    laneWidth,
    recipeBase,
    vector?.width,
    widthDraft,
    zoom,
  ]);

  const recipeSemanticProblems = useMemo(
    () => validateRecipeSemantics(currentRecipe),
    [currentRecipe]
  );

  useEffect(() => {
    setSourceDrafts((current) => {
      const missingSources = currentRecipe.sources.filter(
        (source) => current[source.id] === undefined
      );
      if (missingSources.length === 0) {
        return current;
      }
      return {
        ...current,
        ...Object.fromEntries(missingSources.map((source) => [source.id, '0'])),
      };
    });
  }, [currentRecipe.sources, setSourceDrafts]);

  useEffect(() => {
    setSamples((current) => {
      let next = current;
      for (const source of currentRecipe.sources) {
        if (current[source.id]?.width === source.width) {
          continue;
        }
        try {
          const value = parseLiteral(sourceDrafts[source.id] ?? '0', {
            width: source.width,
          }).vector;
          if (next === current) {
            next = { ...current };
          }
          next[source.id] = value;
        } catch {
          // The Inspector reports invalid explicit literals when the user applies them.
        }
      }
      return next;
    });
  }, [currentRecipe.sources, setSamples, sourceDrafts]);

  const sampleMap = useMemo(() => new Map(Object.entries(samples)), [samples]);
  const evaluation = useMemo(
    () => evaluateRecipe(currentRecipe, sampleMap),
    [currentRecipe, sampleMap]
  );
  const lastStep = currentRecipe.steps[currentRecipe.steps.length - 1];
  const selectedValueId =
    panelLayout.inspectedValueId ?? lastStep?.id ?? currentRecipe.sources[0]?.id;
  const evaluatedValue = selectedValueId ? evaluation.values.get(selectedValueId) : undefined;
  const displayVector = evaluatedValue?.value ?? vector;
  const ribbonFields = useMemo(
    () =>
      evaluatedValue
        ? projectFieldsToOutput(
            currentRecipe.fields.map((field) => ({
              ...field,
              description: field.description,
              enumValues: field.enumValues,
            })),
            evaluatedValue.provenance
          )
        : fields,
    [currentRecipe.fields, evaluatedValue, fields]
  );

  return {
    currentRecipe,
    displayVector,
    evaluatedValue,
    evaluation,
    recipeSemanticProblems,
    ribbonFields,
    sampleMap,
  };
}

export type RecipeModelState = ReturnType<typeof useRecipeModel>;
