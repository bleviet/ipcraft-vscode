import type { Selection } from '../hooks/useSelection';
import type { YamlPath } from './YamlPathResolver';
import { YamlPathResolver } from './YamlPathResolver';
import { formatBitsLike, parseBitsLike } from '../utils/BitFieldUtils';

interface FieldOperationContext {
  path: YamlPath;
  value: unknown;
  root: unknown;
  selectionRootPath: YamlPath;
  selection: Selection;
}

function normalizeFieldWidth(field: Record<string, unknown>): number {
  let width = 1;

  if (typeof field.bits === 'string') {
    const parsed = parseBitsLike(field.bits);
    if (parsed && parsed.bit_width > 0) {
      width = parsed.bit_width;
    }
  } else if (Number.isFinite(field.bit_width as number) && (field.bit_width as number) > 0) {
    width = Number(field.bit_width);
  }

  return Math.max(1, Math.min(32, Math.trunc(width)));
}

function firstFreeBit(fields: Record<string, unknown>[]): number {
  const used = new Set<number>();

  for (const field of fields) {
    const parsed = typeof field.bits === 'string' ? parseBitsLike(field.bits) : null;
    const bitOffset =
      parsed?.bit_offset ??
      (Number.isFinite(field.bit_offset as number) ? Number(field.bit_offset) : Number.NaN);
    const bitWidth = parsed?.bit_width ?? normalizeFieldWidth(field);
    const offset = Number.isFinite(bitOffset) ? Math.max(0, Math.trunc(bitOffset)) : 0;
    for (let bit = offset; bit < offset + bitWidth; bit++) {
      used.add(bit);
    }
  }

  let lsb = 0;
  while (used.has(lsb) && lsb < 32) {
    lsb++;
  }

  return lsb;
}

function addField(fields: Record<string, unknown>[], payload: Record<string, unknown>) {
  const afterIndex = typeof payload.afterIndex === 'number' ? payload.afterIndex : -1;
  const insertIndex = Math.max(0, Math.min(fields.length, afterIndex + 1));
  const lsb = firstFreeBit(fields);
  const bits = `[${lsb}:${lsb}]`;

  fields.splice(insertIndex, 0, {
    name: payload.name ?? 'NEW_FIELD',
    bits,
    access: payload.access ?? 'read-write',
    description: payload.description ?? '',
  });
}

function deleteField(fields: Record<string, unknown>[], payload: Record<string, unknown>) {
  const index = typeof payload.index === 'number' ? payload.index : -1;
  if (index >= 0 && index < fields.length) {
    fields.splice(index, 1);
  }
}

function moveField(fields: Record<string, unknown>[], payload: Record<string, unknown>) {
  const index = typeof payload.index === 'number' ? payload.index : -1;
  const delta = typeof payload.delta === 'number' ? payload.delta : 0;
  const next = index + delta;
  if (index < 0 || next < 0 || index >= fields.length || next >= fields.length) {
    return;
  }

  const temp = fields[index];
  fields[index] = fields[next];
  fields[next] = temp;

  let offset = 0;
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const width = normalizeFieldWidth(field);
    fields[i] = {
      name: field.name,
      bits: formatBitsLike(offset, width),
      access: field.access,
      reset_value: field.reset_value,
      description: field.description,
      enumerated_values: field.enumerated_values,
    };
    offset += width;
  }
}

export function applyFieldOperation({
  path,
  value,
  root,
  selectionRootPath,
  selection,
}: FieldOperationContext): boolean {
  const operationType = String(path[1] ?? '');
  const payload = (value ?? {}) as Record<string, unknown>;
  const registerYamlPath: YamlPath = [...selectionRootPath, ...selection.path];
  const fieldsPath: YamlPath = [...registerYamlPath, 'fields'];

  const current = YamlPathResolver.getAtPath(root, fieldsPath);
  if (!Array.isArray(current)) {
    YamlPathResolver.setAtPath(root, fieldsPath, []);
  }

  const fields = (YamlPathResolver.getAtPath(root, fieldsPath) ?? []) as Record<string, unknown>[];
  if (!Array.isArray(fields)) {
    return false;
  }

  if (operationType === 'field-add') {
    addField(fields, payload);
    return true;
  }

  if (operationType === 'field-delete') {
    deleteField(fields, payload);
    return true;
  }

  if (operationType === 'field-move') {
    moveField(fields, payload);
    return true;
  }

  return false;
}
