/**
 * Evaluate a width expression (e.g. "AxiDataWidth_g/8") using the supplied
 * parameter defaults. Returns the integer result, or undefined if any
 * identifier cannot be resolved or the expression is invalid.
 *
 * Uses a hand-rolled arithmetic parser instead of `new Function` / `eval`
 * because VS Code webviews block dynamic code execution via CSP.
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
    const result = parseArithmetic(resolved.replace(/\s+/g, ''));
    return Number.isFinite(result) ? Math.trunc(result) : undefined;
  } catch {
    return undefined;
  }
}

function parseArithmetic(expr: string): number {
  let pos = 0;

  const parseNum = (): number => {
    let s = '';
    while (pos < expr.length && (expr[pos] === '.' || (expr[pos] >= '0' && expr[pos] <= '9'))) {
      s += expr[pos++];
    }
    if (!s) {
      throw new Error('expected number');
    }
    return parseFloat(s);
  };

  const parsePrimary = (): number => {
    if (expr[pos] === '-') {
      pos++;
      return -parsePrimary();
    }
    if (expr[pos] === '(') {
      pos++;
      const val = parseAddSub();
      if (expr[pos] !== ')') {
        throw new Error('expected )');
      }
      pos++;
      return val;
    }
    return parseNum();
  };

  const parseMulDiv = (): number => {
    let left = parsePrimary();
    while (pos < expr.length && (expr[pos] === '*' || expr[pos] === '/')) {
      const op = expr[pos++];
      const right = parsePrimary();
      left = op === '*' ? left * right : left / right;
    }
    return left;
  };

  const parseAddSub = (): number => {
    let left = parseMulDiv();
    while (pos < expr.length && (expr[pos] === '+' || expr[pos] === '-')) {
      const op = expr[pos++];
      const right = parseMulDiv();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  };

  const result = parseAddSub();
  if (pos !== expr.length) {
    throw new Error('trailing chars');
  }
  return result;
}
