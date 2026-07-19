import yaml from 'js-yaml';
import type { IPCraftDataInspectorRecipe, Step } from '../domain/dataInspector.types';
import type { InspectorField } from './fieldLayout';
import { validateFieldLayout } from './fieldLayout';

export function parseRecipe(text: string): IPCraftDataInspectorRecipe {
  const parsed = yaml.load(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Data Inspector recipe must be a YAML object');
  }
  return parsed as IPCraftDataInspectorRecipe;
}

export function createEmptyRecipe(name: string): IPCraftDataInspectorRecipe {
  return {
    version: 1,
    name,
    description: '',
    sources: [{ id: 'input', name: 'INPUT', width: 32 }],
    fields: [],
    overlayGroups: [{ id: 'default', name: 'Default' }],
    steps: [],
    view: { laneWidth: 32, zoom: 'field', selectedGroupId: 'default' },
  };
}

export function recipeFields(recipe: IPCraftDataInspectorRecipe): InspectorField[] {
  return recipe.fields.map(
    ({ display: _display, importProvenance: _provenance, sourceId: _sourceId, ...field }) => field
  );
}

function requiredParameter(step: Step, key: keyof Step): string | null {
  return step[key] === undefined ? `Step ${step.id} (${step.type}) requires ${String(key)}` : null;
}

/** Validates cross-references, widths, and overlay collisions that JSON Schema cannot express. */
export function validateRecipeSemantics(recipe: IPCraftDataInspectorRecipe): string[] {
  const errors: string[] = [];
  const allIds = new Set<string>();
  const addId = (id: string, kind: string) => {
    if (allIds.has(id)) {
      errors.push(`Duplicate stable ID ${id} (${kind})`);
    }
    allIds.add(id);
  };
  recipe.sources.forEach((source) => addId(source.id, 'source'));
  recipe.fields.forEach((field) => addId(field.id, 'field'));
  recipe.overlayGroups.forEach((group) => addId(group.id, 'overlay group'));
  recipe.steps.forEach((step) => addId(step.id, 'step'));

  const sourceWidths = new Map(recipe.sources.map((source) => [source.id, source.width]));
  const valueIds = new Set([...sourceWidths.keys(), ...recipe.steps.map((step) => step.id)]);
  const groupIds = new Set(recipe.overlayGroups.map((group) => group.id));
  for (const source of recipe.sources) {
    const fields = recipe.fields.filter((field) => field.sourceId === source.id);
    const inspectorFields = fields.map(
      ({ display: _display, importProvenance: _provenance, sourceId: _sourceId, ...field }) => field
    );
    errors.push(...validateFieldLayout(inspectorFields, source.width));
  }
  for (const field of recipe.fields) {
    const width = sourceWidths.get(field.sourceId);
    if (width === undefined) {
      errors.push(`Field ${field.id} references missing source ${field.sourceId}`);
    }
    if (!groupIds.has(field.groupId)) {
      errors.push(`Field ${field.id} references missing overlay group ${field.groupId}`);
    }
    const fieldWidth = field.msb - field.lsb + 1;
    if (field.display.interpretation === 'float' && ![16, 32, 64].includes(fieldWidth)) {
      errors.push(`Field ${field.id} float interpretation requires 16, 32, or 64 bits`);
    }
    if (
      field.display.interpretation === 'fixedPoint' &&
      (field.display.fractionalBits === undefined || field.display.fractionalBits >= fieldWidth)
    ) {
      errors.push(
        `Field ${field.id} fixed-point interpretation requires fractionalBits below its width`
      );
    }
  }

  const valueWidths = new Map(sourceWidths);
  for (const step of recipe.steps) {
    const inputWidth = valueWidths.get(step.inputId);
    if (inputWidth === undefined) {
      if (valueIds.has(step.inputId)) {
        errors.push(`Step ${step.id} references unavailable input ${step.inputId}`);
      }
      continue;
    }
    let outputWidth = inputWidth;
    let parameterError: string | null = null;
    if (['concat', 'and', 'or', 'xor'].includes(step.type)) {
      parameterError = requiredParameter(step, 'operandId');
      const operandWidth = step.operandId ? valueWidths.get(step.operandId) : undefined;
      if (step.operandId && operandWidth === undefined) {
        if (valueIds.has(step.operandId)) {
          errors.push(`Step ${step.id} references unavailable operand ${step.operandId}`);
        }
        continue;
      } else if (step.type === 'concat' && operandWidth !== undefined) {
        outputWidth = inputWidth + operandWidth;
      } else if (operandWidth !== undefined && operandWidth !== inputWidth) {
        errors.push(`Step ${step.id} operands must have equal widths`);
      }
    } else if (step.type === 'slice') {
      parameterError = requiredParameter(step, 'msb') ?? requiredParameter(step, 'lsb');
      if (step.msb !== undefined && step.lsb !== undefined) {
        if (step.lsb < 0 || step.msb < step.lsb || step.msb >= inputWidth) {
          errors.push(`Step ${step.id} slice [${step.msb}:${step.lsb}] is outside its input`);
        } else {
          outputWidth = step.msb - step.lsb + 1;
        }
      }
    } else if (['shiftLeft', 'shiftRight'].includes(step.type)) {
      parameterError = requiredParameter(step, 'amount');
    } else if (['zeroExtend', 'signExtend'].includes(step.type)) {
      parameterError = requiredParameter(step, 'width');
      if (step.width !== undefined) {
        if (step.width <= inputWidth) {
          errors.push(`Step ${step.id} extension width must be greater than ${inputWidth}`);
        }
        outputWidth = step.width;
      }
    } else if (step.type === 'truncate') {
      parameterError = requiredParameter(step, 'width');
      if (step.width !== undefined) {
        if (step.width >= inputWidth) {
          errors.push(`Step ${step.id} truncation width must be below ${inputWidth}`);
        }
        outputWidth = step.width;
      }
    } else if (step.type === 'byteSwap' && inputWidth % 8 !== 0) {
      errors.push(`Step ${step.id} byte swap requires a whole number of bytes`);
    }
    if (parameterError) {
      errors.push(parameterError);
    }
    if (outputWidth > 4096) {
      errors.push(`Step ${step.id} produces ${outputWidth} bits, above the 4096-bit ceiling`);
    } else {
      valueWidths.set(step.id, outputWidth);
    }
  }
  return errors;
}
