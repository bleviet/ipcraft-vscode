import { YamlService } from './YamlService';
import type { YamlPath } from './YamlPathResolver';
import { applyPathDeletes } from '../../yamledit';

/**
 * `['__op', 'register-edit']`: several writes inside one register as ONE document update, so a
 * gesture that needs more than a single path write (e.g. creating fields on a register that still
 * carries a register-level `$version` reference, which must go in the same update) stays atomic.
 * Paths are relative to the register the editor is showing.
 */
export const REGISTER_EDIT_OP = 'register-edit';

export interface RegisterEditPayload {
  edits: Array<{ path: YamlPath; value: unknown }>;
  /** Keys removed from the register after the edits (the key is deleted, not set to null). */
  removeKeys?: YamlPath[];
}

/** The register's own `resetValue` key: where a register-level `$version` reference lives. */
const REGISTER_RESET_KEY: YamlPath = ['resetValue'];

/**
 * The `onUpdate` arguments that write a new `fields` array into a register. When the register
 * still carries a register-level `$version` reference (`dropRegisterReset`), that reference is
 * removed in the same update: it is invalid next to bit fields, which hold the references.
 */
export function fieldsWriteUpdate(
  fields: unknown[],
  dropRegisterReset: boolean
): [YamlPath, unknown] {
  if (!dropRegisterReset) {
    return [['fields'], fields];
  }
  const payload: RegisterEditPayload = {
    edits: [{ path: ['fields'], value: fields }],
    removeKeys: [REGISTER_RESET_KEY],
  };
  return [['__op', REGISTER_EDIT_OP], payload];
}

/**
 * The `onUpdate` arguments for a Value bar commit that writes field resets on a register that
 * still carries a register-level `$version` reference: the field writes and the removal of that
 * reference are one update.
 */
export function fieldResetsWriteUpdate(
  resets: ReadonlyArray<{ fieldIndex: number; value: number | bigint }>
): [YamlPath, unknown] {
  const payload: RegisterEditPayload = {
    edits: resets.map(({ fieldIndex, value }) => ({
      path: ['fields', fieldIndex, 'resetValue'],
      value,
    })),
    removeKeys: [REGISTER_RESET_KEY],
  };
  return [['__op', REGISTER_EDIT_OP], payload];
}

/** Applies a `register-edit` payload to the register at `registerPath`; returns the new text. */
export function applyRegisterEdit(
  text: string,
  registerPath: YamlPath,
  payload: RegisterEditPayload
): string {
  const edited = YamlService.applyPathEdits(
    text,
    payload.edits.map(({ path, value }) => ({ path: [...registerPath, ...path], value }))
  );
  const removals = (payload.removeKeys ?? []).map((path) => [...registerPath, ...path]);
  return removals.length > 0 ? applyPathDeletes(edited, removals) : edited;
}
