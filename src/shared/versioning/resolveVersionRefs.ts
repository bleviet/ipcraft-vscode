/**
 * The single resolution step for `$version` references at generation time: replaces each
 * reference's reset value with the number it stands for in the owning core's version and forces
 * the target read-only. `versionRef` stays on the result so generators can tell constants from
 * ordinary read-only fields.
 *
 * Pure: returns a new map and never throws. A reference that cannot be resolved (free scheme,
 * component missing from the scheme, unparsable version) keeps its reset value 0; the generation
 * gate refuses such designs before this result is used.
 */
import type {
  NormalizedField,
  NormalizedMemoryMap,
  NormalizedRegister,
} from '../../domain/internal.types';
import { resolveVersionRef, type VersionScheme } from './versionScheme';

function resolveField(field: NormalizedField, scheme: VersionScheme, version: string) {
  if (!field.versionRef) {
    return field;
  }
  const value = resolveVersionRef(scheme, version, field.versionRef);
  return { ...field, resetValue: value ?? 0, access: 'read-only' };
}

/**
 * A non-zero register-level reset word carries the constants too: each constant field's bit range
 * is replaced by its resolved value, so the word, the fields and every consumer agree.
 */
function spliceConstants(
  word: number,
  sources: readonly NormalizedField[],
  resolved: readonly NormalizedField[]
): number {
  return sources.reduce((value, source, index) => {
    if (!source.versionRef) {
      return value;
    }
    const unit = 2 ** source.offset;
    const current = Math.floor(value / unit) % 2 ** source.width;
    return value - current * unit + resolved[index].resetValue * unit;
  }, word);
}

function resolveRegister(
  register: NormalizedRegister,
  scheme: VersionScheme,
  version: string
): NormalizedRegister {
  const fields = register.fields.map((field) => resolveField(field, scheme, version));
  const registers = register.registers?.map((nested) => resolveRegister(nested, scheme, version));
  const own = register.versionRef
    ? {
        resetValue: resolveVersionRef(scheme, version, register.versionRef) ?? 0,
        access: 'read-only',
      }
    : {};
  return {
    ...register,
    ...own,
    ...(register.resetValue !== 0 && !register.versionRef
      ? { resetValue: spliceConstants(register.resetValue, register.fields, fields) }
      : {}),
    fields,
    ...(registers ? { registers } : {}),
  };
}

export function resolveVersionRefsInMap(
  map: NormalizedMemoryMap,
  scheme: VersionScheme,
  version: string
): NormalizedMemoryMap {
  return {
    ...map,
    addressBlocks: map.addressBlocks.map((block) => ({
      ...block,
      registers: block.registers.map((register) => resolveRegister(register, scheme, version)),
    })),
  };
}
