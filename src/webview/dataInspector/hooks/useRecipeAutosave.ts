import { useEffect, type MutableRefObject } from 'react';
import type { IPCraftDataInspectorRecipe } from '../../../domain/dataInspector.types';
import type { DataInspectorToExtensionMessage } from '../../../shared/messages/dataInspector';
import { nextEditRevision, type RevisionState } from '../../sync/revisionFilter';

interface RecipeAutosaveOptions {
  currentRecipe: IPCraftDataInspectorRecipe;
  enabled: boolean;
  postMessage: ((message: DataInspectorToExtensionMessage) => void) | undefined;
  revisionStateRef: MutableRefObject<RevisionState>;
  semanticProblemCount: number;
}

export function useRecipeAutosave({
  currentRecipe,
  enabled,
  postMessage,
  revisionStateRef,
  semanticProblemCount,
}: RecipeAutosaveOptions) {
  useEffect(() => {
    if (!enabled || semanticProblemCount > 0) {
      return;
    }
    const timeout = window.setTimeout(() => {
      postMessage?.({
        type: 'updateRecipe',
        recipe: currentRecipe,
        ...nextEditRevision(revisionStateRef.current),
      });
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [currentRecipe, enabled, postMessage, revisionStateRef, semanticProblemCount]);
}
