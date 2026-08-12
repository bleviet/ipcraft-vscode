import type { BusDefinitionContract, CanonicalBusMatch, NormalizedBusLibrary } from './types';

interface ParsedVlnv {
  vendor: string;
  library: string;
  name: string;
  version: string;
}

function parseVlnv(value: string): ParsedVlnv | null {
  const parts = value.split(':');
  if (parts.length !== 4 || parts.some((part) => part.length === 0)) {
    return null;
  }
  return {
    vendor: parts[0],
    library: parts[1],
    name: parts[2],
    version: parts[3],
  };
}

function toMatch(
  contract: BusDefinitionContract,
  matchedBy: CanonicalBusMatch['matchedBy']
): CanonicalBusMatch {
  return {
    key: contract.key,
    canonicalVlnv: contract.canonicalVlnv,
    contract,
    matchedBy,
  };
}

export function canonicalizeBusType(
  type: string,
  library: NormalizedBusLibrary
): CanonicalBusMatch | null {
  const trimmed = type.trim();
  const canonical = Object.values(library.definitions).find(
    (definition) => definition.canonicalVlnv === trimmed
  );
  if (canonical) {
    return toMatch(canonical, 'canonicalVlnv');
  }

  const shortValue = trimmed.toLowerCase();
  const shortAlias = library.aliases.find(
    (alias) => alias.kind === 'short' && alias.shortValue === shortValue
  );
  if (shortAlias) {
    const contract = Object.values(library.definitions).find(
      (definition) => definition.canonicalVlnv === shortAlias.canonicalVlnv
    );
    return contract ? toMatch(contract, 'shortAlias') : null;
  }

  const parsed = parseVlnv(trimmed);
  if (!parsed) {
    return null;
  }
  const structuredAlias = library.aliases.find(
    (alias) =>
      alias.kind === 'vlnv' &&
      alias.vendor === parsed.vendor &&
      alias.library === parsed.library &&
      alias.name === parsed.name &&
      (alias.version === '*' || alias.version === parsed.version)
  );
  if (!structuredAlias) {
    return null;
  }
  const contract = Object.values(library.definitions).find(
    (definition) => definition.canonicalVlnv === structuredAlias.canonicalVlnv
  );
  return contract ? toMatch(contract, 'structuredAlias') : null;
}

export function normalizeInterfaceMode(
  contract: BusDefinitionContract,
  mode: string
): string | null {
  const normalized = mode.trim().toLowerCase();
  if (normalized === contract.modePolicy.producer) {
    return contract.modePolicy.producer;
  }
  if (normalized === contract.modePolicy.consumer) {
    return contract.modePolicy.consumer;
  }
  return contract.modePolicy.aliases[normalized] ?? null;
}

export function isConsumerInterface(contract: BusDefinitionContract, mode: string): boolean {
  return normalizeInterfaceMode(contract, mode) === contract.modePolicy.consumer;
}
