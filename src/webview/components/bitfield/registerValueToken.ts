/**
 * `$version` references in the register value bar. A register without bit fields can hold any
 * reference itself (its own `resetValue`); with fields the references belong on the fields, so
 * the bar only explains where to enter them. Pure.
 */
import {
  VERSION_REFS,
  parseVersionRef,
  type VersionRef,
} from '../../../shared/versioning/versionScheme';
import { VERSION_REF_IN_DEBUG_MODE_ERROR } from '../../shared/utils/versionRefDisplay';
import { parseRegisterBitVector, type RegisterValueParse } from './utils';

/**
 * Like `parseRegisterBitVector`, plus: the trimmed text of a valid reference parses as the token,
 * and a proper prefix of any valid reference (`$`, `$ver`, `$version.cr`, ...) as a draft still
 * being typed rather than a malformed number.
 */
export function parseRegisterValueDraft(
  text: string,
  view: 'hex' | 'dec',
  width: number
): RegisterValueParse {
  const trimmed = text.trim();
  const token = parseVersionRef(trimmed);
  if (token) {
    return { vector: null, error: null, token };
  }
  if (trimmed !== '' && VERSION_REFS.some((ref) => ref.startsWith(trimmed))) {
    return { vector: null, error: null, pending: true };
  }
  return parseRegisterBitVector(text, view, width);
}

export type RegisterTokenDecision =
  | { kind: 'commit'; token: VersionRef }
  | { kind: 'error'; message: string };

/** Whether the typed reference may be written to the register's own `resetValue`. */
export function decideRegisterToken(context: {
  token: VersionRef;
  hasFields: boolean;
  debugMode: boolean;
}): RegisterTokenDecision {
  if (context.hasFields) {
    return {
      kind: 'error',
      message:
        context.token === '$version'
          ? 'Use $version.* on the bit fields'
          : `Enter ${context.token} in a bit field's Reset cell`,
    };
  }
  if (context.debugMode) {
    return { kind: 'error', message: VERSION_REF_IN_DEBUG_MODE_ERROR };
  }
  return { kind: 'commit', token: context.token };
}
