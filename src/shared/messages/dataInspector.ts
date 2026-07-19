import type { InspectorField } from '../../dataInspector/fieldLayout';
import type { IPCraftDataInspectorRecipe } from '../../domain/dataInspector.types';

export interface RegisterLayoutCopy {
  id: string;
  label: string;
  width: number;
  fields: InspectorField[];
  sourceFile: string;
  registerName: string;
}

export type DataInspectorToExtensionMessage =
  | { type: 'ready' }
  | { type: 'requestRegisterLayouts' }
  | {
      type: 'updateRecipe';
      recipe: IPCraftDataInspectorRecipe;
      editId: number;
      baseDocVersion?: number;
    }
  | { type: 'saveRecipe'; recipe: IPCraftDataInspectorRecipe };

export type DataInspectorToWebviewMessage =
  | { type: 'registerLayouts'; layouts: RegisterLayoutCopy[] }
  | {
      type: 'recipe';
      recipe: IPCraftDataInspectorRecipe;
      fileName: string;
      docVersion: number;
      sourceEditId?: number;
      forceResync?: boolean;
    }
  | { type: 'recipeError'; error: string }
  | { type: 'applyRegisterLayout'; layout: RegisterLayoutCopy };
