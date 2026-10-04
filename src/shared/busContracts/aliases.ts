import type { BusAlias } from '../../domain/busDefinition.types';
import type { NormalizedBusAlias } from './types';

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** Separator- and case-insensitive key, so `AVALON_STREAMING` and `Avalon-ST` compare like `AVALONST`. */
export function shortAliasKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_.-]/g, '');
}

export function normalizeBusAlias(
  alias: BusAlias,
  canonicalVlnv: string
): NormalizedBusAlias | null {
  if (alias.kind === 'short') {
    const shortValue = alias.value.trim().toLowerCase();
    return shortValue ? { kind: 'short', canonicalVlnv, shortValue } : null;
  }
  if (
    !nonEmpty(alias.vendor) ||
    !nonEmpty(alias.library) ||
    !nonEmpty(alias.name) ||
    !nonEmpty(alias.version)
  ) {
    return null;
  }
  return {
    kind: 'vlnv',
    canonicalVlnv,
    vendor: alias.vendor,
    library: alias.library,
    name: alias.name,
    version: alias.version,
  };
}

export function busAliasIdentity(alias: NormalizedBusAlias): string {
  return alias.kind === 'short'
    ? `short:${shortAliasKey(alias.shortValue ?? '')}`
    : `vlnv:${alias.vendor}:${alias.library}:${alias.name}:${alias.version}`;
}
