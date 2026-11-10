export function parseBitBounds(bits: string, requireBrackets: boolean): [number, number] | null {
  const source = String(bits ?? '').trim();
  if (!source) {
    return null;
  }

  const normalized = source.replace(/\s+/g, '');
  const bracketedMatch = normalized.match(/^\[(\d+)(?::(\d+))?\]$/);
  if (bracketedMatch) {
    const hi = Number(bracketedMatch[1]);
    const lo = Number(bracketedMatch[2] ?? bracketedMatch[1]);
    return [hi, lo];
  }

  if (requireBrackets) {
    return null;
  }

  const bareMatch = normalized.match(/^(\d+)(?::(\d+))?$/);
  if (!bareMatch) {
    return null;
  }

  const hi = Number(bareMatch[1]);
  const lo = Number(bareMatch[2] ?? bareMatch[1]);
  return [hi, lo];
}

/**
 * Parses a bits string '[hi:lo]' or '[n]' into [hi, lo].
 * Returns null if the format is unrecognised.
 */
export function parseBitsRange(bits: string): [number, number] | null {
  return parseBitBounds(bits, true);
}
