import type { DerivedOperation } from '../../domain/busDefinition.types';
import type { WidthExprNode } from '../widthExprAst';
import {
  binaryExpression,
  numericExpression,
  resolveNumericExpression,
  resolveNumericValue,
  type ParameterContext,
} from './expression';
import type { ResolvedNumericValue, ResolvedSemanticValue } from './types';

function isNumeric(value: ResolvedSemanticValue | undefined): value is ResolvedNumericValue {
  return Boolean(value && (typeof value.value === 'number' || 'expression' in value));
}

function unresolvedFrom(
  values: readonly (ResolvedNumericValue | undefined)[]
): ResolvedNumericValue {
  if (values.some((value) => value?.state === 'invalid')) {
    return { state: 'invalid', reason: 'A derivation operand is invalid.' };
  }
  if (values.some((value) => value?.state === 'unresolved' || value === undefined)) {
    return { state: 'unresolved', reason: 'A derivation operand is unresolved.' };
  }
  return { state: 'symbolic', reason: 'A derivation remains symbolic.' };
}

function operationOperand(
  operation: DerivedOperation,
  portWidths: Readonly<Record<string, ResolvedNumericValue>>,
  properties: Readonly<Record<string, ResolvedSemanticValue>>
): ResolvedNumericValue | undefined {
  if ('port' in operation && operation.port) {
    return portWidths[operation.port];
  }
  if ('property' in operation && operation.property) {
    const property = properties[operation.property];
    return isNumeric(property) ? property : undefined;
  }
  return undefined;
}

export function deriveOperation(
  operation: DerivedOperation,
  portWidths: Readonly<Record<string, ResolvedNumericValue>>,
  properties: Readonly<Record<string, ResolvedSemanticValue>>,
  context: ParameterContext,
  minimum: number
): ResolvedNumericValue {
  const operand = operationOperand(operation, portWidths, properties);

  switch (operation.operation) {
    case 'copyPort':
      return operand ?? { state: 'unresolved', reason: 'The source port is unresolved.' };
    case 'multiplyBy': {
      const multiplier: ResolvedNumericValue = {
        state: 'concrete',
        value: operation.multiplier,
      };
      const expression = operand && binaryExpression('*', operand, multiplier);
      return expression
        ? resolveNumericExpression(expression, context, minimum)
        : unresolvedFrom([operand]);
    }
    case 'divideBy': {
      const divisor =
        'divisorProperty' in operation
          ? properties[operation.divisorProperty]
          : ({ state: 'concrete', value: operation.divisor } as ResolvedNumericValue);
      const numericDivisor = isNumeric(divisor) ? divisor : undefined;
      const expression =
        operand && numericDivisor && binaryExpression('/', operand, numericDivisor);
      return expression
        ? resolveNumericExpression(expression, context, minimum)
        : unresolvedFrom([operand, numericDivisor]);
    }
    case 'multiplyProperties': {
      const [leftName, rightName] = operation.properties;
      const left = properties[leftName];
      const right = properties[rightName];
      const numericLeft = isNumeric(left) ? left : undefined;
      const numericRight = isNumeric(right) ? right : undefined;
      const expression =
        numericLeft && numericRight && binaryExpression('*', numericLeft, numericRight);
      return expression
        ? resolveNumericExpression(expression, context, minimum)
        : unresolvedFrom([numericLeft, numericRight]);
    }
    case 'ceilLog2':
    case 'bitsForMaximum': {
      if (!operand) {
        return { state: 'unresolved', reason: 'The logarithm operand is unresolved.' };
      }
      let argument = numericExpression(operand);
      if (operation.operation === 'bitsForMaximum' && argument) {
        argument = {
          type: 'Binary',
          op: '+',
          left: argument,
          right: { type: 'Number', value: 1 },
        };
      }
      const expression: WidthExprNode | undefined = argument
        ? { type: 'Call', fn: 'clog2', args: [argument] }
        : undefined;
      return expression
        ? resolveNumericExpression(expression, context, minimum)
        : unresolvedFrom([operand]);
    }
    case 'maxEncodableValue': {
      if (operand?.value === undefined || operand.state !== 'concrete') {
        return unresolvedFrom([operand]);
      }
      return resolveNumericValue(2 ** operand.value - 1, context, minimum);
    }
  }
}

export function sameResolution(
  left: ResolvedSemanticValue | undefined,
  right: ResolvedSemanticValue | undefined
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function resolveToFixpoint(maxPasses: number, updatePass: () => boolean): void {
  for (let pass = 0; pass < maxPasses; pass++) {
    if (!updatePass()) {
      return;
    }
  }
}
