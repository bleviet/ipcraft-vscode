import * as path from 'path';
import type { IPCraftDataInspectorRecipe } from '../domain/dataInspector.types';
import { YamlValidator } from '../services/YamlValidator';
import { validateRecipeSemantics } from './recipe';

export function validateDataInspectorRecipe(
  recipe: IPCraftDataInspectorRecipe,
  extensionPath: string,
  yamlValidator = new YamlValidator()
): void {
  const schemaPath = path.join(
    extensionPath,
    'dist',
    'resources',
    'schemas',
    'data_inspector.schema.json'
  );
  const schemaResult = yamlValidator.validateAgainstSchema(recipe, schemaPath);
  if (!schemaResult.valid) {
    throw new Error(schemaResult.error ?? 'Recipe schema validation failed');
  }
  const semanticErrors = validateRecipeSemantics(recipe);
  if (semanticErrors.length > 0) {
    throw new Error(semanticErrors.join('; '));
  }
}
