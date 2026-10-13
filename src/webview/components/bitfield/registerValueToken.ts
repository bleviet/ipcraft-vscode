/**
 * `$version` in the register value bar. Only a register without bit fields can hold the token
 * itself (its own `resetValue`); with fields the references belong on the fields. Pure.
 */
import { VERSION_REF_IN_DEBUG_MODE_ERROR } from '../../shared/utils/versionRefDisplay';
import { parseRegisterBitVector, type RegisterValueParse } from './utils';

export const REGISTER_VERSION_TOKEN = '$version';

/**
 * Like `parseRegisterBitVector`, plus: the trimmed text `$version` parses as the token, and a
 * proper prefix of it (`$`, `$ver`, ...) as a draft still being typed rather than a malformed number.
 */
export function parseRegisterValueDraft(
  text: string,
  view: 'hex' | 'dec',
  width: number
): RegisterValueParse {
  const trimmed = text.trim();
  if (trimmed === REGISTER_VERSION_TOKEN) {
    return { vector: null, error: null, token: REGISTER_VERSION_TOKEN };
  }
  if (trimmed !== '' && REGISTER_VERSION_TOKEN.startsWith(trimmed)) {
    return { vector: null, error: null, pending: true };
  }
  return parseRegisterBitVector(text, view, width);
}

export type RegisterTokenDecision =
  | { kind: 'commit'; token: typeof REGISTER_VERSION_TOKEN }
  | { kind: 'error'; message: string };

/** Whether the typed `$version` token may be written to the register's own `resetValue`. */
export function decideRegisterToken(context: {
  hasFields: boolean;
  debugMode: boolean;
}): RegisterTokenDecision {
  if (context.hasFields) {
    return { kind: 'error', message: 'Use $version.* on the bit fields' };
  }
  if (context.debugMode) {
    return { kind: 'error', message: VERSION_REF_IN_DEBUG_MODE_ERROR };
  }
  return { kind: 'commit', token: REGISTER_VERSION_TOKEN };
}
