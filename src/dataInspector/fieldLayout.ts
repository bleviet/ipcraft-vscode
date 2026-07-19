import { BitVector } from './BitVector';
import { uniqueStableId } from './stableId';

export interface InspectorField {
  id: string;
  name: string;
  msb: number;
  lsb: number;
  groupId: string;
  description?: string;
  enumValues?: Record<string, string>;
}

export interface SourceInspectorField extends InspectorField {
  sourceId: string;
}

export interface ProjectedInspectorField extends InspectorField {
  sourceFieldId: string;
}

/** Copies a register layout into one source with IDs unique across the whole recipe. */
export function copyFieldsForSource(
  fields: readonly InspectorField[],
  sourceId: string,
  existingIds: ReadonlySet<string>
): InspectorField[] {
  const usedIds = new Set(existingIds);
  return fields.map((field) => {
    const id = uniqueStableId(`${sourceId}-${field.id}`, usedIds);
    usedIds.add(id);
    return { ...field, id };
  });
}

/** Projects source-local field ranges onto a derived value using per-bit provenance. */
export function projectFieldsToOutput(
  fields: readonly SourceInspectorField[],
  provenance: ReadonlyArray<{ sourceId: string; sourceBit: number } | null>
): ProjectedInspectorField[] {
  return fields.flatMap((field) => {
    const outputBits = provenance.flatMap((origin, outputBit) =>
      origin?.sourceId === field.sourceId &&
      origin.sourceBit >= field.lsb &&
      origin.sourceBit <= field.msb
        ? [outputBit]
        : []
    );
    const runs: Array<{ lsb: number; msb: number }> = [];
    for (const outputBit of outputBits) {
      const current = runs[runs.length - 1];
      if (current && outputBit === current.msb + 1) {
        current.msb = outputBit;
      } else {
        runs.push({ lsb: outputBit, msb: outputBit });
      }
    }
    return runs.map((run, index) => ({
      ...field,
      id: `${field.id}--projected-${index}`,
      sourceFieldId: field.id,
      msb: run.msb,
      lsb: run.lsb,
    }));
  });
}

export function validateFieldLayout(
  fields: readonly InspectorField[],
  vectorWidth: number
): string[] {
  const errors: string[] = [];
  const occupiedByGroup = new Map<string, Map<number, string>>();
  for (const field of fields) {
    if (
      !Number.isInteger(field.msb) ||
      !Number.isInteger(field.lsb) ||
      field.lsb < 0 ||
      field.msb < field.lsb ||
      field.msb >= vectorWidth
    ) {
      errors.push(
        `${field.name} range [${field.msb}:${field.lsb}] is outside [${vectorWidth - 1}:0]`
      );
      continue;
    }
    const occupied = occupiedByGroup.get(field.groupId) ?? new Map<number, string>();
    occupiedByGroup.set(field.groupId, occupied);
    for (let bit = field.lsb; bit <= field.msb; bit++) {
      const owner = occupied.get(bit);
      if (owner !== undefined) {
        errors.push(`${field.name} overlaps ${owner} at bit ${bit} in group ${field.groupId}`);
        break;
      }
      occupied.set(bit, field.name);
    }
  }
  return errors;
}

export function decodeField(vector: BitVector, field: InspectorField): BitVector {
  return vector.slice(field.msb, field.lsb);
}
