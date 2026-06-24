/**
 * AST-based width-expression core.
 *
 * Parses a port-width expression (e.g. "AxiDataWidth_g/8" or "clog2(DEPTH)")
 * into a small AST, then either evaluates it numerically or serializes it into
 * one of the HDL/tool dialects (SystemVerilog, VHDL, Tcl, IP-XACT XPATH).
 *
 * Hand-rolled recursive-descent parser — no eval / new Function — so it is safe
 * under both VS Code webview CSP and the Node.js extension host.
 *
 * Supported grammar:
 *   expr    := addsub
 *   addsub  := muldiv (('+' | '-') muldiv)*
 *   muldiv  := unary  (('*' | '/') unary)*
 *   unary   := '-' unary | primary
 *   primary := number | call | paramref | '(' addsub ')'
 *   call    := ident '(' addsub (',' addsub)* ')'
 *
 * Identifiers immediately followed by '(' are function calls; any other
 * identifier is a parameter reference. Function names are matched
 * case-insensitively and canonicalised to lowercase.
 */

export type WidthExprNode =
  | { type: 'Number'; value: number }
  | { type: 'ParamRef'; name: string }
  | { type: 'Unary'; op: '-'; operand: WidthExprNode }
  | { type: 'Binary'; op: '+' | '-' | '*' | '/'; left: WidthExprNode; right: WidthExprNode }
  | { type: 'Call'; fn: WidthFunctionName; args: WidthExprNode[] };

export type WidthFunctionName = 'clog2' | 'log2' | 'ceil' | 'floor' | 'abs' | 'min' | 'max';

export type WidthDialect = 'systemverilog' | 'vhdl' | 'tcl' | 'ipxact';

/** Number of arguments each predefined function takes. */
const FUNCTION_ARITY: Record<WidthFunctionName, number> = {
  clog2: 1,
  log2: 1,
  ceil: 1,
  floor: 1,
  abs: 1,
  min: 2,
  max: 2,
};

/** VHDL functions whose serialization requires `use ieee.math_real.all;`. */
const VHDL_MATH_REAL_FUNCTIONS: ReadonlySet<WidthFunctionName> = new Set<WidthFunctionName>([
  'clog2',
  'log2',
  'ceil',
  'floor',
]);

function isFunctionName(name: string): name is WidthFunctionName {
  return Object.prototype.hasOwnProperty.call(FUNCTION_ARITY, name);
}

/**
 * Parse a width expression into an AST. Returns `undefined` for any syntax
 * error, unknown function name, or wrong function arity — which is stricter and
 * more correct than a permissive allow-regex.
 */
export function parse(expr: string): WidthExprNode | undefined {
  const src = expr.replace(/\s+/g, '');
  if (!src) {
    return undefined;
  }
  let pos = 0;

  // Inner parsers are function declarations (hoisted) so the recursive-descent
  // grammar can reference functions defined later (e.g. parsePrimary -> parseAddSub).
  function peek(): string {
    return src[pos];
  }

  function parseIdentifier(): string {
    let s = '';
    while (pos < src.length && /[A-Za-z0-9_]/.test(src[pos])) {
      s += src[pos++];
    }
    return s;
  }

  function parseNumber(): WidthExprNode {
    let s = '';
    while (pos < src.length && /[0-9.]/.test(src[pos])) {
      s += src[pos++];
    }
    const value = parseFloat(s);
    if (!Number.isFinite(value)) {
      throw new Error('invalid number');
    }
    return { type: 'Number', value };
  }

  function parsePrimary(): WidthExprNode {
    const ch = peek();
    if (ch === '(') {
      pos++;
      const inner = parseAddSub();
      if (peek() !== ')') {
        throw new Error('expected )');
      }
      pos++;
      return inner;
    }
    if (ch >= '0' && ch <= '9') {
      return parseNumber();
    }
    if (/[A-Za-z_]/.test(ch)) {
      const ident = parseIdentifier();
      if (peek() === '(') {
        // Function call.
        const fn = ident.toLowerCase();
        if (!isFunctionName(fn)) {
          throw new Error(`unknown function ${ident}`);
        }
        pos++; // consume '('
        const args: WidthExprNode[] = [];
        if (peek() !== ')') {
          args.push(parseAddSub());
          while (peek() === ',') {
            pos++;
            args.push(parseAddSub());
          }
        }
        if (peek() !== ')') {
          throw new Error('expected ) after arguments');
        }
        pos++;
        if (args.length !== FUNCTION_ARITY[fn]) {
          throw new Error(`${fn} expects ${FUNCTION_ARITY[fn]} argument(s)`);
        }
        return { type: 'Call', fn, args };
      }
      return { type: 'ParamRef', name: ident };
    }
    throw new Error(`unexpected token ${ch ?? '<eof>'}`);
  }

  function parseUnary(): WidthExprNode {
    if (peek() === '-') {
      pos++;
      return { type: 'Unary', op: '-', operand: parseUnary() };
    }
    return parsePrimary();
  }

  function parseMulDiv(): WidthExprNode {
    let left = parseUnary();
    while (peek() === '*' || peek() === '/') {
      const op = src[pos++] as '*' | '/';
      left = { type: 'Binary', op, left, right: parseUnary() };
    }
    return left;
  }

  function parseAddSub(): WidthExprNode {
    let left = parseMulDiv();
    while (peek() === '+' || peek() === '-') {
      const op = src[pos++] as '+' | '-';
      left = { type: 'Binary', op, left, right: parseMulDiv() };
    }
    return left;
  }

  try {
    const ast = parseAddSub();
    if (pos !== src.length) {
      return undefined; // trailing characters
    }
    return ast;
  } catch {
    return undefined;
  }
}

/**
 * Numerically evaluate an AST. Returns `undefined` if any parameter is
 * unresolved or a function receives an out-of-domain argument. The result may
 * be fractional; callers that need an integer width should truncate.
 */
export function evaluate(
  ast: WidthExprNode,
  paramDefaults: Map<string, number> | Record<string, number>
): number | undefined {
  const defaults: Record<string, number> =
    paramDefaults instanceof Map ? Object.fromEntries(paramDefaults) : paramDefaults;

  const visit = (node: WidthExprNode): number | undefined => {
    switch (node.type) {
      case 'Number':
        return node.value;
      case 'ParamRef': {
        const v = defaults[node.name];
        return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
      }
      case 'Unary': {
        const operand = visit(node.operand);
        return operand === undefined ? undefined : -operand;
      }
      case 'Binary': {
        const left = visit(node.left);
        const right = visit(node.right);
        if (left === undefined || right === undefined) {
          return undefined;
        }
        switch (node.op) {
          case '+':
            return left + right;
          case '-':
            return left - right;
          case '*':
            return left * right;
          case '/':
            return left / right;
        }
        return undefined;
      }
      case 'Call': {
        const args = node.args.map(visit);
        if (args.some((a) => a === undefined)) {
          return undefined;
        }
        return applyFunction(node.fn, args as number[]);
      }
    }
  };

  return visit(ast);
}

function applyFunction(fn: WidthFunctionName, args: number[]): number | undefined {
  switch (fn) {
    case 'clog2': {
      // Ceiling of log2; matches SystemVerilog $clog2. clog2(0) is undefined
      // (surface the error rather than silently emit a 0-bit port); clog2(1)=0.
      const n = args[0];
      if (n <= 0) {
        return undefined;
      }
      if (n <= 1) {
        return 0;
      }
      return Math.ceil(Math.log2(n));
    }
    case 'log2': {
      // Floor of log2 (exact when a power of two).
      const n = args[0];
      return n <= 0 ? undefined : Math.floor(Math.log2(n));
    }
    case 'ceil':
      return Math.ceil(args[0]);
    case 'floor':
      return Math.floor(args[0]);
    case 'abs':
      return Math.abs(args[0]);
    case 'min':
      return Math.min(args[0], args[1]);
    case 'max':
      return Math.max(args[0], args[1]);
  }
}

/** True iff any `ParamRef` exists anywhere in the tree (drives is_parameterized). */
export function containsParamRef(ast: WidthExprNode): boolean {
  switch (ast.type) {
    case 'ParamRef':
      return true;
    case 'Number':
      return false;
    case 'Unary':
      return containsParamRef(ast.operand);
    case 'Binary':
      return containsParamRef(ast.left) || containsParamRef(ast.right);
    case 'Call':
      return ast.args.some(containsParamRef);
  }
}

/** True iff any `Call` (predefined function) exists anywhere in the tree. */
export function containsCall(ast: WidthExprNode): boolean {
  switch (ast.type) {
    case 'Call':
      return true;
    case 'Number':
    case 'ParamRef':
      return false;
    case 'Unary':
      return containsCall(ast.operand);
    case 'Binary':
      return containsCall(ast.left) || containsCall(ast.right);
  }
}

/**
 * True iff serializing this expression to VHDL would require
 * `use ieee.math_real.all;` (a parameterized clog2/log2/ceil/floor call). A
 * constant call folds to a literal and needs no library.
 */
export function widthExprUsesMathReal(expr: string): boolean {
  const ast = parse(expr);
  if (!ast || !containsParamRef(ast)) {
    return false;
  }
  const visit = (node: WidthExprNode): boolean => {
    switch (node.type) {
      case 'Call':
        return VHDL_MATH_REAL_FUNCTIONS.has(node.fn) || node.args.some(visit);
      case 'Unary':
        return visit(node.operand);
      case 'Binary':
        return visit(node.left) || visit(node.right);
      default:
        return false;
    }
  };
  return visit(ast);
}

export interface SerializeCtx {
  /** Custom rendering for a parameter reference (e.g. Tcl `[get_parameter_value X]`). */
  paramRef?: (name: string) => string;
}

export interface SerializeResult {
  code: string;
  /** True if any function call was emitted (not constant-folded to a literal). */
  usedFunction: boolean;
}

/** Sentinel returned for `max`/`min` in the IP-XACT dialect (see Decision 4). */
export const IPXACT_UNSUPPORTED = ' IPXACT_UNSUPPORTED';

/**
 * Serialize an AST to the given dialect.
 *
 * Constant-folding: if the expression has no unresolved parameter and
 * evaluates to a finite number, the literal is emitted directly in every
 * dialect (`clog2(8)` -> `3`).
 */
export function serialize(
  ast: WidthExprNode,
  dialect: WidthDialect,
  ctx: SerializeCtx = {}
): SerializeResult {
  // Constant-fold: anything with no ParamRef and a finite value becomes a literal.
  if (!containsParamRef(ast)) {
    const value = evaluate(ast, {});
    if (value !== undefined && Number.isFinite(value)) {
      return { code: String(Math.trunc(value)), usedFunction: false };
    }
  }

  let usedFunction = false;
  let unsupported = false;

  const paramRef = (name: string): string => (ctx.paramRef ? ctx.paramRef(name) : name);

  // Operator precedence for parenthesization. Atoms are highest.
  const precedence = (node: WidthExprNode): number => {
    switch (node.type) {
      case 'Binary':
        return node.op === '+' || node.op === '-' ? 1 : 2;
      case 'Unary':
        return 3;
      default:
        return 4;
    }
  };

  const visit = (node: WidthExprNode): string => {
    switch (node.type) {
      case 'Number':
        return String(node.value);
      case 'ParamRef':
        return paramRef(node.name);
      case 'Unary':
        return `-${wrap(node.operand, node)}`;
      case 'Binary':
        return `${wrap(node.left, node)}${node.op}${wrap(node.right, node, true)}`;
      case 'Call':
        usedFunction = true;
        return serializeCall(node);
    }
  };

  // Parenthesize a child when its precedence is lower than the parent, or equal
  // on the right side of a left-associative operator.
  const wrap = (child: WidthExprNode, parent: WidthExprNode, isRight = false): string => {
    const code = visit(child);
    const childPrec = precedence(child);
    const parentPrec = precedence(parent);
    if (childPrec < parentPrec || (isRight && childPrec === parentPrec)) {
      return `(${code})`;
    }
    return code;
  };

  const serializeCall = (node: Extract<WidthExprNode, { type: 'Call' }>): string => {
    const a = node.args.map(visit);
    switch (dialect) {
      case 'systemverilog':
        return serializeSvCall(node.fn, a);
      case 'vhdl':
        return serializeVhdlCall(node.fn, a);
      case 'tcl':
        return serializeTclCall(node.fn, a);
      case 'ipxact': {
        const result = serializeIpxactCall(node.fn, a);
        if (result === IPXACT_UNSUPPORTED) {
          unsupported = true;
        }
        return result;
      }
    }
  };

  const code = visit(ast);
  if (unsupported) {
    return { code: IPXACT_UNSUPPORTED, usedFunction };
  }
  return { code, usedFunction };
}

function serializeSvCall(fn: WidthFunctionName, args: string[]): string {
  switch (fn) {
    case 'clog2':
      return `$clog2(${args[0]})`;
    case 'ceil':
      // SystemVerilog has no synthesizable real ceil/floor; on integer width
      // expressions these are no-ops, so emit the argument directly.
      return args[0];
    case 'floor':
      return args[0];
    case 'abs':
      return `((${args[0]}) < 0 ? -(${args[0]}) : (${args[0]}))`;
    case 'min':
      return `((${args[0]}) < (${args[1]}) ? (${args[0]}) : (${args[1]}))`;
    case 'max':
      return `((${args[0]}) > (${args[1]}) ? (${args[0]}) : (${args[1]}))`;
    case 'log2':
      // No SystemVerilog built-in for floor-log2; numeric-eval only (Decision 5).
      throw new Error('log2 has no SystemVerilog serialization');
  }
}

function serializeVhdlCall(fn: WidthFunctionName, args: string[]): string {
  switch (fn) {
    case 'clog2':
      return `integer(ceil(log2(real(${args[0]}))))`;
    case 'log2':
      return `integer(floor(log2(real(${args[0]}))))`;
    case 'ceil':
      return `integer(ceil(real(${args[0]})))`;
    case 'floor':
      return `integer(floor(real(${args[0]})))`;
    case 'abs':
      return `abs(${args[0]})`;
    case 'min':
      return `minimum(${args[0]}, ${args[1]})`;
    case 'max':
      return `maximum(${args[0]}, ${args[1]})`;
  }
}

function serializeTclCall(fn: WidthFunctionName, args: string[]): string {
  // Tcl `log` is natural log, so log2(x) = log(x)/log(2).
  switch (fn) {
    case 'clog2':
      return `int(ceil(log(${args[0]})/log(2)))`;
    case 'log2':
      return `int(floor(log(${args[0]})/log(2)))`;
    case 'ceil':
      return `int(ceil(${args[0]}))`;
    case 'floor':
      return `int(floor(${args[0]}))`;
    case 'abs':
      return `abs(${args[0]})`;
    case 'min':
      return `min(${args[0]},${args[1]})`;
    case 'max':
      return `max(${args[0]},${args[1]})`;
  }
}

function serializeIpxactCall(fn: WidthFunctionName, args: string[]): string {
  // Vivado UG1118 XPATH functions in spirit:dependency.
  switch (fn) {
    case 'clog2':
      return `ceiling(log(2, ${args[0]}))`;
    case 'log2':
      return `floor(log(2, ${args[0]}))`;
    case 'ceil':
      return `ceiling(${args[0]})`;
    case 'floor':
      return `floor(${args[0]})`;
    case 'abs':
      return `abs(${args[0]})`;
    case 'min':
    case 'max':
      // UG1118 lists min/max as node-set functions with no two-scalar form.
      return IPXACT_UNSUPPORTED;
  }
}

/**
 * Lowercase recognized function-name tokens to their canonical spelling
 * (`CLOG2(x)` -> `clog2(x)`), leaving numbers and parameter names untouched.
 * Used on the webview save path so YAML stays consistent without divergent
 * spellings. Returns the input unchanged if it does not parse.
 */
export function normalizeFunctionNames(expr: string): string {
  return expr.replace(/([A-Za-z_][A-Za-z0-9_]*)(\s*\()/g, (match, name: string, paren: string) => {
    const lower = name.toLowerCase();
    return isFunctionName(lower) ? `${lower}${paren}` : match;
  });
}
