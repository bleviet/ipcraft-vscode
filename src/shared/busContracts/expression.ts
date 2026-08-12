import type { Parameter } from '../../domain/ipcore.types';
import { evaluate, parse, type WidthExprNode } from '../widthExprAst';
import type { ResolvedNumericValue } from './types';

export interface ParameterContext {
  names: ReadonlySet<string>;
  defaults: ReadonlyMap<string, number>;
  domains: ReadonlyMap<string, readonly number[]>;
}

function rawParameterValue(parameter: Parameter): unknown {
  return parameter.value ?? parameter.defaultValue;
}

function isValidNumber(value: number, minimum: number): boolean {
  return (
    Number.isFinite(value) &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

export function collectParameterNames(expression: WidthExprNode): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: WidthExprNode): void => {
    switch (node.type) {
      case 'ParamRef':
        names.add(node.name);
        return;
      case 'Unary':
        visit(node.operand);
        return;
      case 'Binary':
        visit(node.left);
        visit(node.right);
        return;
      case 'Call':
        node.args.forEach(visit);
        return;
      case 'Number':
        return;
    }
  };
  visit(expression);
  return names;
}

export function normalizeExpression(expression: WidthExprNode): WidthExprNode {
  let normalized: WidthExprNode;
  switch (expression.type) {
    case 'Number':
    case 'ParamRef':
      normalized = { ...expression };
      break;
    case 'Unary':
      normalized = { ...expression, operand: normalizeExpression(expression.operand) };
      break;
    case 'Binary':
      normalized = {
        ...expression,
        left: normalizeExpression(expression.left),
        right: normalizeExpression(expression.right),
      };
      break;
    case 'Call':
      normalized = { ...expression, args: expression.args.map(normalizeExpression) };
      break;
  }

  if (collectParameterNames(normalized).size === 0) {
    const value = evaluate(normalized, {});
    if (value !== undefined && Number.isFinite(value)) {
      return { type: 'Number', value };
    }
  }
  return normalized;
}

export function expressionsEqual(
  left: WidthExprNode | undefined,
  right: WidthExprNode | undefined
): boolean {
  if (!left || !right) {
    return false;
  }
  return JSON.stringify(normalizeExpression(left)) === JSON.stringify(normalizeExpression(right));
}

export function createParameterContext(parameters: readonly Parameter[]): ParameterContext {
  const names = new Set(parameters.map((parameter) => parameter.name));
  const defaults = new Map<string, number>();

  for (const parameter of parameters) {
    const value = rawParameterValue(parameter);
    if (typeof value === 'number' && Number.isFinite(value)) {
      defaults.set(parameter.name, value);
    }
  }

  for (let pass = 0; pass < parameters.length; pass++) {
    let changed = false;
    for (const parameter of parameters) {
      if (defaults.has(parameter.name)) {
        continue;
      }
      const value = rawParameterValue(parameter);
      if (typeof value !== 'string') {
        continue;
      }
      const expression = parse(value);
      const resolved = expression ? evaluate(expression, defaults) : undefined;
      if (resolved !== undefined && Number.isFinite(resolved)) {
        defaults.set(parameter.name, resolved);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  const domains = new Map<string, readonly number[]>();
  for (const parameter of parameters) {
    const allowed = (parameter.allowedValues ?? []).filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value)
    );
    if (allowed.length > 0) {
      domains.set(parameter.name, Object.freeze([...allowed]));
    } else {
      const fallback = defaults.get(parameter.name);
      if (fallback !== undefined) {
        domains.set(parameter.name, Object.freeze([fallback]));
      }
    }
  }

  return Object.freeze({ names, defaults, domains });
}

export function resolveNumericValue(
  rawValue: unknown,
  context: ParameterContext,
  minimum = 1
): ResolvedNumericValue {
  if (typeof rawValue === 'number') {
    return isValidNumber(rawValue, minimum)
      ? { state: 'concrete', value: rawValue }
      : {
          state: 'invalid',
          reason: `Expected a safe integer greater than or equal to ${minimum}.`,
        };
  }
  if (typeof rawValue !== 'string') {
    return { state: 'unresolved', reason: 'No numeric value was declared.' };
  }

  const parsed = parse(rawValue);
  if (!parsed) {
    return { state: 'invalid', reason: `Invalid width expression '${rawValue}'.` };
  }
  const expression = normalizeExpression(parsed);
  const unknown = [...collectParameterNames(expression)].filter((name) => !context.names.has(name));
  if (unknown.length > 0) {
    return {
      state: 'unresolved',
      expression,
      reason: `Undeclared parameter${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`,
    };
  }

  const value = evaluate(expression, new Map(context.defaults));
  if (value === undefined) {
    return { state: 'symbolic', expression, reason: 'No concrete parameter default is available.' };
  }
  if (!isValidNumber(value, minimum)) {
    return {
      state: 'invalid',
      expression,
      reason: `Expression must resolve to a safe integer greater than or equal to ${minimum}.`,
    };
  }
  return { state: 'concrete', value, expression };
}

export function resolveNumericExpression(
  expression: WidthExprNode,
  context: ParameterContext,
  minimum = 1
): ResolvedNumericValue {
  const normalized = normalizeExpression(expression);
  const unknown = [...collectParameterNames(normalized)].filter((name) => !context.names.has(name));
  if (unknown.length > 0) {
    return { state: 'unresolved', expression: normalized, reason: 'Expression is unresolved.' };
  }
  const value = evaluate(normalized, new Map(context.defaults));
  if (value === undefined) {
    return { state: 'symbolic', expression: normalized };
  }
  if (!isValidNumber(value, minimum)) {
    return {
      state: 'invalid',
      expression: normalized,
      reason: 'Expression is not a valid integer.',
    };
  }
  return { state: 'concrete', value, expression: normalized };
}

export function numericExpression(value: ResolvedNumericValue): WidthExprNode | undefined {
  if (value.expression) {
    return value.expression;
  }
  return value.value !== undefined ? { type: 'Number', value: value.value } : undefined;
}

export function binaryExpression(
  op: '+' | '-' | '*' | '/',
  left: ResolvedNumericValue,
  right: ResolvedNumericValue
): WidthExprNode | undefined {
  const leftExpression = numericExpression(left);
  const rightExpression = numericExpression(right);
  return leftExpression && rightExpression
    ? normalizeExpression({ type: 'Binary', op, left: leftExpression, right: rightExpression })
    : undefined;
}

export function evaluateResolved(
  value: ResolvedNumericValue | undefined,
  parameters: ReadonlyMap<string, number> | Record<string, number>
): number | undefined {
  if (!value) {
    return undefined;
  }
  if (value.expression) {
    const environment =
      typeof (parameters as ReadonlyMap<string, number>).get === 'function'
        ? new Map(parameters as ReadonlyMap<string, number>)
        : (parameters as Record<string, number>);
    return evaluate(value.expression, environment);
  }
  return value.value;
}
