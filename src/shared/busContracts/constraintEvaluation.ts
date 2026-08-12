import type { BusInterface, Parameter } from '../../domain/ipcore.types';
import {
  binaryExpression,
  collectParameterNames,
  evaluateResolved,
  expressionsEqual,
  numericExpression,
  type ParameterContext,
} from './expression';
import type {
  BusConformanceDiagnostic,
  BusDefinitionContract,
  NormalizedBusConstraint,
  ResolvedBusPort,
  ResolvedNumericValue,
  ResolvedSemanticValue,
  ResolutionState,
} from './types';

export interface ConstraintEvaluationInput {
  contract: BusDefinitionContract;
  busInterface: BusInterface;
  busIndex: number;
  parameters: readonly Parameter[];
  parameterContext: ParameterContext;
  portWidths: Readonly<Record<string, ResolvedNumericValue>>;
  properties: Readonly<Record<string, ResolvedSemanticValue>>;
  activePorts: readonly ResolvedBusPort[];
}

interface RelationResult {
  valid: boolean | undefined;
  suggestedValue?: number;
}

function numericProperty(
  properties: Readonly<Record<string, ResolvedSemanticValue>>,
  name: string
): ResolvedNumericValue | undefined {
  const property = properties[name];
  if (!property) {
    return undefined;
  }
  return typeof property.value === 'number' || 'expression' in property
    ? (property as ResolvedNumericValue)
    : undefined;
}

function constraintValues(
  constraint: NormalizedBusConstraint,
  input: ConstraintEvaluationInput
): ResolvedNumericValue[] {
  const values: ResolvedNumericValue[] = [];
  const addPort = (name: unknown): void => {
    if (typeof name === 'string' && input.portWidths[name]) {
      values.push(input.portWidths[name]);
    }
  };
  const addProperty = (name: unknown): void => {
    if (typeof name === 'string') {
      const value = numericProperty(input.properties, name);
      if (value) {
        values.push(value);
      }
    }
  };
  if ('port' in constraint) {
    addPort(constraint.port);
  }
  if (constraint.kind === 'portWidthQuotient') {
    addPort(constraint.dividendPort);
  }
  if (constraint.kind === 'portWidthsEqual') {
    constraint.ports.forEach(addPort);
  }
  if ('property' in constraint) {
    addProperty(constraint.property);
  }
  if (constraint.kind === 'productEqualsPort') {
    constraint.properties.forEach(addProperty);
  }
  return values;
}

function relationState(values: readonly ResolvedNumericValue[]): ResolutionState {
  if (values.some((value) => value.state === 'invalid')) {
    return 'invalid';
  }
  if (values.some((value) => value.state === 'unresolved')) {
    return 'unresolved';
  }
  if (values.some((value) => value.state === 'symbolic')) {
    return 'symbolic';
  }
  return 'concrete';
}

function activeNames(input: ConstraintEvaluationInput): ReadonlySet<string> {
  return new Set(input.activePorts.map((port) => port.name));
}

function valueAt(
  value: ResolvedNumericValue | undefined,
  parameters: ReadonlyMap<string, number> | Record<string, number>
): number | undefined {
  const evaluated = evaluateResolved(value, parameters);
  return evaluated !== undefined && Number.isFinite(evaluated) ? evaluated : undefined;
}

function structurallyProven(
  constraint: NormalizedBusConstraint,
  input: ConstraintEvaluationInput
): boolean {
  switch (constraint.kind) {
    case 'portWidthsEqual': {
      const ports = constraint.ports.filter((name) => activeNames(input).has(name));
      const expressions = ports.map((name) => numericExpression(input.portWidths[name]));
      return (
        expressions.length >= 2 &&
        expressions.every((expr) => expressionsEqual(expr, expressions[0]))
      );
    }
    case 'portWidthQuotient': {
      if (!activeNames(input).has(constraint.port)) {
        return true;
      }
      const target = input.portWidths[constraint.port];
      const dividend = input.portWidths[constraint.dividendPort];
      const divisor: ResolvedNumericValue = { state: 'concrete', value: constraint.divisor };
      const expected = binaryExpression('/', dividend, divisor);
      return expressionsEqual(numericExpression(target), expected);
    }
    case 'productEqualsPort': {
      const propertyNames = constraint.properties;
      const left = numericProperty(input.properties, propertyNames[0]);
      const right = numericProperty(input.properties, propertyNames[1]);
      const expected = left && right ? binaryExpression('*', left, right) : undefined;
      return expressionsEqual(numericExpression(input.portWidths[constraint.port]), expected);
    }
    default:
      return false;
  }
}

function evaluateRelation(
  constraint: NormalizedBusConstraint,
  input: ConstraintEvaluationInput,
  parameters: ReadonlyMap<string, number> | Record<string, number>
): RelationResult {
  const active = activeNames(input);
  const port = 'port' in constraint ? input.portWidths[constraint.port ?? ''] : undefined;
  const property =
    'property' in constraint
      ? numericProperty(input.properties, constraint.property ?? '')
      : undefined;
  const subject = port ?? property;

  switch (constraint.kind) {
    case 'range': {
      const value = valueAt(subject, parameters);
      if (value === undefined) {
        return { valid: undefined };
      }
      return {
        valid:
          (constraint.minimum === undefined || value >= constraint.minimum) &&
          (constraint.maximum === undefined || value <= constraint.maximum),
      };
    }
    case 'allowedValues': {
      const value = valueAt(subject, parameters);
      return value === undefined
        ? { valid: undefined }
        : { valid: constraint.values.includes(value) };
    }
    case 'multipleOf': {
      const value = valueAt(subject, parameters);
      return value === undefined ? { valid: undefined } : { valid: value % constraint.value === 0 };
    }
    case 'powerOfTwo': {
      const value = valueAt(subject, parameters);
      if (value === undefined) {
        return { valid: undefined };
      }
      return {
        valid:
          Number.isInteger(value) &&
          value > 0 &&
          (value & (value - 1)) === 0 &&
          (constraint.minimum === undefined || value >= constraint.minimum) &&
          (constraint.maximum === undefined || value <= constraint.maximum),
      };
    }
    case 'portWidthsEqual': {
      const names = constraint.ports.filter((name) => active.has(name));
      if (names.length < 2) {
        return { valid: true };
      }
      const values = names.map((name) => valueAt(input.portWidths[name], parameters));
      return values.some((value) => value === undefined)
        ? { valid: undefined }
        : { valid: values.every((value) => value === values[0]), suggestedValue: values[0] };
    }
    case 'portWidthQuotient': {
      if (!active.has(constraint.port)) {
        return { valid: true };
      }
      const target = valueAt(input.portWidths[constraint.port], parameters);
      const dividend = valueAt(input.portWidths[constraint.dividendPort], parameters);
      if (target === undefined || dividend === undefined) {
        return { valid: undefined };
      }
      const expected = dividend / constraint.divisor;
      return { valid: target === expected, suggestedValue: expected };
    }
    case 'productEqualsPort': {
      const names = constraint.properties;
      const target = valueAt(input.portWidths[constraint.port], parameters);
      const left = valueAt(numericProperty(input.properties, names[0]), parameters);
      const right = valueAt(numericProperty(input.properties, names[1]), parameters);
      if (target === undefined || left === undefined || right === undefined) {
        return { valid: undefined };
      }
      return { valid: target === left * right, suggestedValue: left * right };
    }
    case 'portPresenceRequires': {
      if (!active.has(constraint.port)) {
        return { valid: true };
      }
      return { valid: constraint.requires.every((name) => active.has(name)) };
    }
    case 'propertyRequiredWhenPortPresent': {
      if (!active.has(constraint.port)) {
        return { valid: true };
      }
      const value = input.properties[constraint.property];
      return { valid: value !== undefined && !['unresolved', 'invalid'].includes(value.state) };
    }
    case 'propertyFitsPort': {
      if (!active.has(constraint.port)) {
        return { valid: true };
      }
      const width = valueAt(input.portWidths[constraint.port], parameters);
      const maximum = valueAt(numericProperty(input.properties, constraint.property), parameters);
      if (width === undefined || maximum === undefined) {
        return { valid: undefined };
      }
      return { valid: maximum >= 0 && maximum <= 2 ** width - 1, suggestedValue: 2 ** width - 1 };
    }
  }
}

function constraintPath(
  constraint: NormalizedBusConstraint,
  input: ConstraintEvaluationInput
): readonly (string | number)[] {
  if ('property' in constraint && constraint.property) {
    return ['busInterfaces', input.busIndex, 'interfaceProperties', constraint.property];
  }
  if ('port' in constraint && constraint.port) {
    return ['busInterfaces', input.busIndex, 'portWidthOverrides', constraint.port];
  }
  if (constraint.kind === 'portWidthsEqual' && constraint.ports[0]) {
    return ['busInterfaces', input.busIndex, 'portWidthOverrides', constraint.ports[0]];
  }
  return ['busInterfaces', input.busIndex, 'type'];
}

function diagnosticFor(
  constraint: NormalizedBusConstraint,
  input: ConstraintEvaluationInput,
  state: ResolutionState,
  suggestedValue?: number
): BusConformanceDiagnostic {
  return {
    code: constraint.code,
    ruleId: constraint.ruleId,
    severity: constraint.severity,
    state,
    interfaceName: input.busInterface.name,
    path: constraintPath(constraint, input),
    message: constraint.message ?? `${constraint.ruleId} is not satisfied.`,
    ...(suggestedValue !== undefined && Number.isSafeInteger(suggestedValue)
      ? { suggestedValue }
      : {}),
  };
}

function parameterNamesFor(values: readonly ResolvedNumericValue[]): string[] {
  const names = new Set<string>();
  for (const value of values) {
    if (value.expression) {
      collectParameterNames(value.expression).forEach((name) => names.add(name));
    }
  }
  return [...names];
}

function enumerateDomains(
  names: readonly string[],
  context: ParameterContext
): ReadonlyMap<string, number>[] | null {
  const domains = names.map((name) => context.domains.get(name));
  if (domains.some((domain) => domain === undefined)) {
    return null;
  }
  const combinations: Map<string, number>[] = [];
  const visit = (index: number, values: Map<string, number>): void => {
    if (index === names.length) {
      combinations.push(new Map(values));
      return;
    }
    for (const value of domains[index] ?? []) {
      values.set(names[index], value);
      visit(index + 1, values);
    }
  };
  visit(0, new Map());
  return combinations;
}

export function evaluateContractConstraints(
  input: ConstraintEvaluationInput
): readonly BusConformanceDiagnostic[] {
  const diagnostics: BusConformanceDiagnostic[] = [];

  for (const constraint of input.contract.constraints) {
    if ('port' in constraint && constraint.port && !activeNames(input).has(constraint.port)) {
      continue;
    }
    const values = constraintValues(constraint, input);
    const state = relationState(values);
    if (state === 'invalid') {
      diagnostics.push(diagnosticFor(constraint, input, 'invalid'));
      continue;
    }
    if (structurallyProven(constraint, input)) {
      continue;
    }

    const defaultResult = evaluateRelation(constraint, input, input.parameterContext.defaults);
    if (defaultResult.valid === false) {
      diagnostics.push(diagnosticFor(constraint, input, 'concrete', defaultResult.suggestedValue));
    }

    const parameterNames = parameterNamesFor(values);
    if (parameterNames.length === 0) {
      if (defaultResult.valid === undefined) {
        diagnostics.push(diagnosticFor(constraint, input, state));
      }
      continue;
    }

    const domainSize = parameterNames.reduce(
      (size, name) => size * (input.parameterContext.domains.get(name)?.length ?? 0),
      1
    );
    if (domainSize > 256) {
      diagnostics.push({
        code: 'CONFORMANCE_DOMAIN_NOT_EXHAUSTIVE',
        ruleId: constraint.ruleId,
        severity: 'warning',
        state: 'unresolved',
        interfaceName: input.busInterface.name,
        path: constraintPath(constraint, input),
        message: `${constraint.ruleId} references ${domainSize} allowed-value combinations; the limit is 256.`,
      });
      continue;
    }

    const combinations = enumerateDomains(parameterNames, input.parameterContext);
    if (!combinations) {
      if (defaultResult.valid === undefined) {
        diagnostics.push(diagnosticFor(constraint, input, 'unresolved'));
      }
      continue;
    }
    if (
      defaultResult.valid !== false &&
      combinations.some(
        (combination) => evaluateRelation(constraint, input, combination).valid === false
      )
    ) {
      diagnostics.push(diagnosticFor(constraint, input, 'concrete'));
    }
  }

  return Object.freeze(diagnostics);
}
