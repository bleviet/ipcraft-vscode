import { parse, evaluate } from './widthExprAst';

/**
 * Evaluate a width expression (e.g. "AxiDataWidth_g/8" or "clog2(DEPTH)") using
 * the supplied parameter defaults. Returns the integer result, or undefined if
 * any identifier cannot be resolved or the expression is invalid.
 *
 * Thin wrapper over the AST core in widthExprAst.ts (parse -> evaluate). Uses no
 * eval / new Function, so it is safe under both the VS Code webview CSP and the
 * Node.js extension-host contexts.
 */
export function evalWidthExpr(
  expr: string,
  paramDefaults: Map<string, number> | Record<string, number>
): number | undefined {
  const ast = parse(expr);
  if (!ast) {
    return undefined;
  }
  const result = evaluate(ast, paramDefaults);
  return result !== undefined && Number.isFinite(result) ? Math.trunc(result) : undefined;
}
