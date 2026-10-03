/**
 * Pure helpers for the `_hw.tcl` importer: reduce the small Tcl `expr` subset
 * that appears in port widths and loop bounds, and detect leftover Tcl syntax.
 * One tokenizer/evaluator serves both the symbolic (width) and numeric (loop
 * bound) paths.
 */

type ExprToken =
  | { kind: 'num'; value: number }
  | { kind: 'id'; name: string }
  | { kind: 'op'; op: string };

const TCL_SYNTAX = /[$[\]{}]|\bexpr\b/;

/** Removes one pair of surrounding quotes or braces from a Tcl word. */
export function unquoteTclWord(word: string): string {
  return /^"[^"]*"$|^\{[^{}]*\}$/.test(word) ? word.slice(1, -1) : word;
}

/** True when `s` still contains Tcl syntax that must never reach the YAML. */
export function hasTclSyntax(s: string): boolean {
  return TCL_SYNTAX.test(s);
}

/** Index of the `]` matching the `[` at `start`, or -1. */
function matchingBracket(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '[') {
      depth++;
    } else if (text[i] === ']') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Strips the `expr` keyword, one level of enclosing braces, and an enclosing
 * `[expr ...]` command substitution; folds `[get_parameter_value P]` to `P`.
 */
function normalizeExprText(text: string): string {
  let t = text.trim();
  if (t.startsWith('[') && matchingBracket(t, 0) === t.length - 1) {
    const inner = t.slice(1, -1).trim();
    if (/^expr\b/.test(inner)) {
      t = inner;
    }
  }
  t = t.replace(/^expr\b\s*/, '');
  if (t.startsWith('{') && t.endsWith('}')) {
    t = t.slice(1, -1);
  }
  return t
    .replace(/\[\s*get_parameter_value\s+("[^"]*"|\{[^{}]*\}|\w+)\s*\]/g, (_m, name: string) =>
      unquoteTclWord(name)
    )
    .trim();
}

/** Two-character then one-character comparison/logic operators, accepted in conditions only. */
const CONDITION_OPS = ['==', '!=', '<=', '>=', '&&', '||', '<', '>', '!'];

function tokenizeExpr(text: string, allowCondition = false): ExprToken[] | null {
  const tokens: ExprToken[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      i++;
    } else if (/\d/.test(ch)) {
      const m = /^\d+/.exec(text.slice(i))!;
      tokens.push({ kind: 'num', value: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_]\w*/.exec(text.slice(i))!;
      if (m[0] === 'expr') {
        return null;
      }
      tokens.push({ kind: 'id', name: m[0] });
      i += m[0].length;
    } else if ('+-*/%()'.includes(ch)) {
      tokens.push({ kind: 'op', op: ch });
      i++;
    } else {
      const op = allowCondition ? CONDITION_OPS.find((o) => text.startsWith(o, i)) : undefined;
      if (!op) {
        return null;
      }
      tokens.push({ kind: 'op', op });
      i += op.length;
    }
  }
  return tokens.length > 0 ? tokens : null;
}

class ExprSyntaxError extends Error {}

interface EvalOutcome {
  syntaxOk: boolean;
  /** null on division by zero or an unsafe integer. */
  value: number | null;
}

type BinaryOps = ReadonlyMap<string, (a: number, b: number) => number>;

const bool = (b: boolean): number => (b ? 1 : 0);
const RELATIONAL_OPS: BinaryOps = new Map([
  ['<', (a, b) => bool(a < b)],
  ['>', (a, b) => bool(a > b)],
  ['<=', (a, b) => bool(a <= b)],
  ['>=', (a, b) => bool(a >= b)],
]);
const EQUALITY_OPS: BinaryOps = new Map([
  ['==', (a, b) => bool(a === b)],
  ['!=', (a, b) => bool(a !== b)],
]);
const AND_OPS: BinaryOps = new Map([['&&', (a, b) => bool(a !== 0 && b !== 0)]]);
const OR_OPS: BinaryOps = new Map([['||', (a, b) => bool(a !== 0 || b !== 0)]]);

/**
 * Recursive-descent evaluation with Tcl integer semantics (floor division).
 * With `condition`, the comparison and logic operators (`== != < > <= >= && || !`)
 * sit above the arithmetic grammar with Tcl precedence, and parentheses accept
 * the full condition grammar.
 */
function evalTokens(
  tokens: ExprToken[],
  lookup: (name: string) => number | undefined,
  condition = false
): EvalOutcome {
  let pos = 0;
  let invalid = false;

  const peekOp = (): string | undefined => {
    const t = tokens[pos];
    return t?.kind === 'op' ? t.op : undefined;
  };

  const parsePrimary = (): number => {
    const t = tokens[pos++];
    if (!t) {
      throw new ExprSyntaxError();
    }
    if (t.kind === 'num') {
      return t.value;
    }
    if (t.kind === 'id') {
      const v = lookup(t.name);
      if (v === undefined) {
        invalid = true;
        return 0;
      }
      return v;
    }
    if (t.op === '(') {
      const v = condition ? parseOr() : parseSum();
      const close = tokens[pos++];
      if (close?.kind !== 'op' || close.op !== ')') {
        throw new ExprSyntaxError();
      }
      return v;
    }
    throw new ExprSyntaxError();
  };

  const parseUnary = (): number => {
    if (peekOp() === '-') {
      pos++;
      return -parseUnary();
    }
    if (condition && peekOp() === '!') {
      pos++;
      return bool(parseUnary() === 0);
    }
    return parsePrimary();
  };

  const parseProduct = (): number => {
    let v = parseUnary();
    for (let op = peekOp(); op === '*' || op === '/' || op === '%'; op = peekOp()) {
      pos++;
      const rhs = parseUnary();
      if (op === '*') {
        v *= rhs;
      } else if (rhs === 0) {
        invalid = true;
      } else if (op === '/') {
        v = Math.floor(v / rhs);
      } else {
        v = v - rhs * Math.floor(v / rhs);
      }
    }
    return v;
  };

  const parseSum = (): number => {
    let v = parseProduct();
    for (let op = peekOp(); op === '+' || op === '-'; op = peekOp()) {
      pos++;
      const rhs = parseProduct();
      v = op === '+' ? v + rhs : v - rhs;
    }
    return v;
  };

  const leftAssoc = (next: () => number, ops: BinaryOps) => (): number => {
    let v = next();
    for (let op = peekOp(); op !== undefined && ops.has(op); op = peekOp()) {
      pos++;
      v = ops.get(op)!(v, next());
    }
    return v;
  };
  const parseRelational = leftAssoc(parseSum, RELATIONAL_OPS);
  const parseEquality = leftAssoc(parseRelational, EQUALITY_OPS);
  const parseAnd = leftAssoc(parseEquality, AND_OPS);
  const parseOr = leftAssoc(parseAnd, OR_OPS);

  try {
    const v = condition ? parseOr() : parseSum();
    if (pos !== tokens.length) {
      return { syntaxOk: false, value: null };
    }
    return { syntaxOk: true, value: invalid || !Number.isSafeInteger(v) ? null : v };
  } catch (e) {
    if (e instanceof ExprSyntaxError) {
      return { syntaxOk: false, value: null };
    }
    throw e;
  }
}

/**
 * Reduces an `expr ...` token. Returns a number when it has no identifiers, the
 * whitespace-collapsed text when every identifier is a known parameter, and null
 * when it uses anything outside the supported subset.
 */
export function reduceTclExpr(
  text: string,
  paramNames: ReadonlySet<string>
): number | string | null {
  const normalized = normalizeExprText(text);
  const tokens = tokenizeExpr(normalized);
  if (!tokens) {
    return null;
  }
  const ids = tokens.filter((t) => t.kind === 'id');
  if (ids.some((t) => !paramNames.has(t.name))) {
    return null;
  }
  if (ids.length === 0) {
    return evalTokens(tokens, () => undefined).value;
  }
  // Symbolic: only validate the shape; identifiers are stand-ins.
  if (!evalTokens(tokens, () => 1).syntaxOk) {
    return null;
  }
  return normalized.replace(/\s+/g, ' ');
}

/** Evaluates a Tcl integer expression, substituting numeric parameter defaults. */
export function evaluateTclInt(
  text: string,
  paramValues: ReadonlyMap<string, number>
): number | null {
  const tokens = tokenizeExpr(normalizeExprText(text));
  return tokens ? evalTokens(tokens, (name) => paramValues.get(name)).value : null;
}

/**
 * Evaluates a Tcl condition (`if` test) against numeric parameter defaults.
 * Nonzero is true. Returns null when it uses strings, unknown identifiers, or
 * anything outside the supported grammar, so the caller can keep it unresolved.
 */
export function evaluateTclCondition(
  text: string,
  paramValues: ReadonlyMap<string, number>
): boolean | null {
  const tokens = tokenizeExpr(normalizeExprText(text), true);
  if (!tokens) {
    return null;
  }
  const value = evalTokens(tokens, (name) => paramValues.get(name), true).value;
  return value === null ? null : value !== 0;
}

/**
 * Numeric parameter defaults: integer defaults as-is, BOOLEAN-style `true` /
 * `false` as 1 / 0. Parameters with any other default are left out.
 */
export function numericParamValues(
  params: ReadonlyArray<{ name: string; defaultValue?: string }>
): Map<string, number> {
  const values = new Map<string, number>();
  for (const p of params) {
    const raw = p.defaultValue?.trim();
    if (!raw) {
      continue;
    }
    const value = /^(?:true|false)$/i.test(raw) ? bool(raw.toLowerCase() === 'true') : Number(raw);
    if (Number.isInteger(value)) {
      values.set(p.name, value);
    }
  }
  return values;
}

/**
 * Resolves an `add_interface_port` width argument. Integer literals become
 * numbers, `expr` forms are reduced, other Tcl-free strings are kept verbatim.
 * Returns undefined when the width still carries Tcl syntax.
 */
export function resolveTclWidth(
  raw: string,
  paramNames: ReadonlySet<string>
): number | string | undefined {
  if (/^\s*-?\d+\s*$/.test(raw)) {
    return parseInt(raw, 10);
  }
  const resolved = /^\s*expr\b/.test(raw) ? reduceTclExpr(raw, paramNames) : raw;
  if (resolved === null || (typeof resolved === 'string' && hasTclSyntax(resolved))) {
    return undefined;
  }
  return resolved;
}
