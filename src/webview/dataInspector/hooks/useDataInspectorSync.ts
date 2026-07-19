import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { BitVector } from '../../../dataInspector/BitVector';
import { recipeFields } from '../../../dataInspector/recipe';
import type { InspectorField } from '../../../dataInspector/fieldLayout';
import type { IPCraftDataInspectorRecipe } from '../../../domain/dataInspector.types';
import type {
  DataInspectorToExtensionMessage,
  DataInspectorToWebviewMessage,
  RegisterLayoutCopy,
} from '../../../shared/messages/dataInspector';
import { shouldApplyUpdate, type RevisionState } from '../../sync/revisionFilter';

interface DataInspectorSyncOptions {
  postMessage: ((message: DataInspectorToExtensionMessage) => void) | undefined;
  revisionStateRef: MutableRefObject<RevisionState>;
  setDraft: Dispatch<SetStateAction<string>>;
  setFieldProvenance: Dispatch<
    SetStateAction<Record<string, { sourceFile: string; registerName: string }>>
  >;
  setFields: Dispatch<SetStateAction<InspectorField[]>>;
  setFieldSourceIds: Dispatch<SetStateAction<Record<string, string>>>;
  setInspectedValueId: Dispatch<SetStateAction<string | null>>;
  setLaneWidth: Dispatch<SetStateAction<8 | 16 | 32 | 64>>;
  setLayouts: Dispatch<SetStateAction<RegisterLayoutCopy[]>>;
  setNextFieldNumber: Dispatch<SetStateAction<number>>;
  setRecipeBase: Dispatch<SetStateAction<IPCraftDataInspectorRecipe | null>>;
  setRecipeError: Dispatch<SetStateAction<string>>;
  setRecipeFileName: Dispatch<SetStateAction<string>>;
  setSamples: Dispatch<SetStateAction<Record<string, BitVector>>>;
  setSelectedNodeId: Dispatch<SetStateAction<string>>;
  setSourceDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  setSourceOriginalTexts: Dispatch<SetStateAction<Record<string, string>>>;
  setVector: Dispatch<SetStateAction<BitVector | null>>;
  setWidthDraft: Dispatch<SetStateAction<string>>;
  setZoom: Dispatch<SetStateAction<'overview' | 'field' | 'bit'>>;
}

export function useDataInspectorSync({
  postMessage,
  revisionStateRef,
  setDraft,
  setFieldProvenance,
  setFields,
  setFieldSourceIds,
  setInspectedValueId,
  setLaneWidth,
  setLayouts,
  setNextFieldNumber,
  setRecipeBase,
  setRecipeError,
  setRecipeFileName,
  setSamples,
  setSelectedNodeId,
  setSourceDrafts,
  setSourceOriginalTexts,
  setVector,
  setWidthDraft,
  setZoom,
}: DataInspectorSyncOptions) {
  const recipeInitializedRef = useRef(false);

  useEffect(() => {
    const receive = (event: MessageEvent<DataInspectorToWebviewMessage>) => {
      if (event.data.type === 'registerLayouts') {
        setLayouts(event.data.layouts);
      } else if (event.data.type === 'recipe') {
        if (!shouldApplyUpdate(revisionStateRef.current, event.data)) {
          return;
        }
        const recipe = event.data.recipe;
        const firstSource = recipe.sources[0];
        if (!recipeInitializedRef.current && firstSource) {
          const initialRecipeVector = BitVector.fromBigInt(BigInt(0), firstSource.width);
          setDraft('0');
          setVector(initialRecipeVector);
          setSamples({ [firstSource.id]: initialRecipeVector });
          setSourceDrafts({ [firstSource.id]: '0' });
          setSourceOriginalTexts({ [firstSource.id]: '0' });
          recipeInitializedRef.current = true;
        }
        setRecipeBase(recipe);
        setRecipeFileName(event.data.fileName);
        setFields(recipeFields(recipe));
        setLaneWidth(recipe.view.laneWidth);
        setZoom(recipe.view.zoom);
        setWidthDraft(String(recipe.sources[0]?.width ?? 32));
        setFieldProvenance(
          Object.fromEntries(
            recipe.fields
              .filter((field) => field.importProvenance !== undefined)
              .map((field) => [field.id, field.importProvenance!])
          )
        );
        setFieldSourceIds(
          Object.fromEntries(recipe.fields.map((field) => [field.id, field.sourceId]))
        );
        const nextNumber =
          recipe.fields.reduce((highest, field) => {
            const match = /^field-(\d+)$/.exec(field.id);
            return match ? Math.max(highest, Number(match[1])) : highest;
          }, 0) + 1;
        setNextFieldNumber((current) => Math.max(current, nextNumber));
        const valueIds = new Set([
          ...recipe.sources.map((source) => source.id),
          ...recipe.steps.map((step) => step.id),
        ]);
        setSelectedNodeId((current) =>
          valueIds.has(current) ? current : (recipe.sources[0]?.id ?? 'input')
        );
        setInspectedValueId((current) =>
          current && valueIds.has(current) ? current : (recipe.sources[0]?.id ?? null)
        );
        setRecipeError('');
      } else if (event.data.type === 'recipeError') {
        setRecipeError(event.data.error);
      } else if (event.data.type === 'applyRegisterLayout') {
        const { layout } = event.data;
        const sourceId = 'input';
        const initialLayoutVector = BitVector.fromBigInt(BigInt(0), layout.width);
        setDraft('0');
        setWidthDraft(String(layout.width));
        setVector(initialLayoutVector);
        setSamples({ [sourceId]: initialLayoutVector });
        setSourceDrafts({ [sourceId]: '0' });
        setSourceOriginalTexts({ [sourceId]: '0' });
        setFields(layout.fields.map((field) => ({ ...field })));
        setFieldSourceIds(Object.fromEntries(layout.fields.map((field) => [field.id, sourceId])));
        setFieldProvenance(
          Object.fromEntries(
            layout.fields.map((field) => [
              field.id,
              { sourceFile: layout.sourceFile, registerName: layout.registerName },
            ])
          )
        );
      }
    };

    window.addEventListener('message', receive);
    postMessage?.({ type: 'ready' });
    postMessage?.({ type: 'requestRegisterLayouts' });
    return () => window.removeEventListener('message', receive);
  }, [
    postMessage,
    revisionStateRef,
    setDraft,
    setFieldProvenance,
    setFields,
    setFieldSourceIds,
    setInspectedValueId,
    setLaneWidth,
    setLayouts,
    setNextFieldNumber,
    setRecipeBase,
    setRecipeError,
    setRecipeFileName,
    setSamples,
    setSelectedNodeId,
    setSourceDrafts,
    setSourceOriginalTexts,
    setVector,
    setWidthDraft,
    setZoom,
  ]);
}
