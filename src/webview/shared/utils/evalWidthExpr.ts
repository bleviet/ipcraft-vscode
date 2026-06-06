/**
 * Evaluate a width expression (e.g. "AxiDataWidth_g/8") using the supplied
 * parameter defaults. Returns the integer result, or undefined if any
 * identifier cannot be resolved or the expression is invalid.
 */
export function evalWidthExpr(
  expr: string,
  paramDefaults: Record<string, number>
): number | undefined {
  const trimmed = expr.trim();
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum)) {
    return asNum;
  }
  let resolved = trimmed;
  for (const name of Object.keys(paramDefaults).sort((a, b) => b.length - a.length)) {
    resolved = resolved.replace(new RegExp(`\\b${name}\\b`, 'g'), String(paramDefaults[name]));
  }
  if (!/^[0-9\s+\-*/().]+$/.test(resolved)) {
    return undefined;
  }
  try {
    const result = new Function(`return (${resolved})`)() as unknown;
    const num = Number(result);
    return Number.isFinite(num) ? Math.trunc(num) : undefined;
  } catch {
    return undefined;
  }
}
