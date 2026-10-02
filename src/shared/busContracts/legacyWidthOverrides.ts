import type { NormalizedBusPort } from './types';

/**
 * IPCraft v0.9.9-v1.0.0 importers stored a byte-qualifier width as its dividend's
 * expression (`WSTRB: AxiDataWidth_g` next to `WDATA: AxiDataWidth_g`), and the
 * generator re-applied the `/8`. Such an override is the derived width written in
 * that old convention, not an authored value, so it is dropped and the contract
 * derives the width.
 */
export function dropLegacyQuotientOverrides(
  ports: readonly NormalizedBusPort[],
  overrides: Record<string, number | string> | undefined
): Record<string, number | string> | undefined {
  if (!overrides) {
    return overrides;
  }
  let result = overrides;
  for (const port of ports) {
    const derivation = port.derivedWidth;
    if (
      port.widthPolicy !== 'derived' ||
      derivation?.operation !== 'divideBy' ||
      !('port' in derivation) ||
      !('divisor' in derivation)
    ) {
      continue;
    }
    const authored = overrides[port.name];
    const dividend = overrides[derivation.port];
    if (
      typeof authored === 'string' &&
      typeof dividend === 'string' &&
      authored.trim() === dividend.trim()
    ) {
      if (result === overrides) {
        result = { ...overrides };
      }
      delete result[port.name];
    }
  }
  return result;
}
