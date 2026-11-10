import type { InspectorField } from '../../dataInspector/fieldLayout';
import type {
  IPCraftDataInspectorRecipe,
  ImportProvenance,
} from '../../domain/dataInspector.types';

/** A layout to copy into a recipe; it may come from a register or a port. */
export interface RegisterLayoutCopy {
  id: string;
  label: string;
  kind: 'register' | 'port';
  width: number;
  fields: InspectorField[];
  sourceFile: string;
  provenance: ImportProvenance;
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
