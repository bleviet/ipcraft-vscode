import type { BusInterface } from '../../domain/ipcore.types';
import { isDeclarativeContract } from './contractVersion';
import { deriveOperation, resolveToFixpoint, sameResolution } from './derivation';
import { resolveNumericValue, type ParameterContext } from './expression';
import type {
  BusConformanceDiagnostic,
  BusDefinitionContract,
  NormalizedPropertyDeclaration,
  ResolvedNumericValue,
  ResolvedSemanticValue,
} from './types';

function semanticValue(
  rawValue: unknown,
  declaration: NormalizedPropertyDeclaration,
  context: ParameterContext
): ResolvedSemanticValue {
  if (declaration.type === 'integer') {
    return typeof rawValue === 'number' || typeof rawValue === 'string'
      ? resolveNumericValue(rawValue, context, declaration.minimum ?? Number.MIN_SAFE_INTEGER)
      : { state: 'invalid', reason: 'Expected an integer or integer expression.' };
  }
  if (declaration.type === 'boolean') {
    return typeof rawValue === 'boolean'
      ? { state: 'concrete', value: rawValue }
      : { state: 'invalid', reason: 'Expected a boolean value.' };
  }
  return typeof rawValue === 'string'
    ? { state: 'concrete', value: rawValue }
    : { state: 'invalid', reason: 'Expected a string value.' };
}

export function resolveProperties(
  contract: BusDefinitionContract,
  busInterface: BusInterface,
  portWidths: Readonly<Record<string, ResolvedNumericValue>>,
  context: ParameterContext,
  busIndex: number,
  diagnostics: BusConformanceDiagnostic[]
): Record<string, ResolvedSemanticValue> {
  const resolved: Record<string, ResolvedSemanticValue> = {};
  const authored = busInterface.interfaceProperties ?? {};

  for (const name of isDeclarativeContract(contract) ? Object.keys(authored) : []) {
    if (!contract.interfaceProperties[name]) {
      diagnostics.push({
        code: 'BUS_UNKNOWN_INTERFACE_PROPERTY',
        ruleId: 'BUS_UNKNOWN_INTERFACE_PROPERTY',
        severity: 'error',
        state: 'invalid',
        interfaceName: busInterface.name,
        path: ['busInterfaces', busIndex, 'interfaceProperties', name],
        message: `Unknown interface property '${name}'. Valid properties: ${Object.keys(
          contract.interfaceProperties
        ).join(', ')}.`,
      });
    }
  }

  for (const [name, declaration] of Object.entries(contract.interfaceProperties)) {
    if (Object.prototype.hasOwnProperty.call(authored, name)) {
      const value = semanticValue(authored[name], declaration, context);
      resolved[name] = value;
      if (value.state !== 'concrete') {
        diagnostics.push({
          code: 'BUS_INTERFACE_PROPERTY_VALUE',
          ruleId: 'BUS_INTERFACE_PROPERTY_VALUE',
          severity: 'error',
          state: value.state,
          interfaceName: busInterface.name,
          path: ['busInterfaces', busIndex, 'interfaceProperties', name],
          message: `Interface property '${name}' is invalid: ${value.reason ?? 'the value could not be resolved'}`,
        });
      }
    } else if (declaration.default !== undefined) {
      resolved[name] = semanticValue(declaration.default, declaration, context);
    } else {
      resolved[name] = { state: 'unresolved', reason: 'The property is not declared.' };
    }
  }

  resolveToFixpoint(Object.keys(contract.interfaceProperties).length, () => {
    let changed = false;
    for (const [name, declaration] of Object.entries(contract.interfaceProperties)) {
      if (
        Object.prototype.hasOwnProperty.call(authored, name) ||
        declaration.default !== undefined ||
        !declaration.derive
      ) {
        continue;
      }
      const next = deriveOperation(
        declaration.derive,
        portWidths,
        resolved,
        context,
        declaration.minimum ?? Number.MIN_SAFE_INTEGER
      );
      if (!sameResolution(next, resolved[name])) {
        resolved[name] = next;
        changed = true;
      }
    }
    return changed;
  });

  for (const [name, declaration] of Object.entries(contract.interfaceProperties)) {
    const value = resolved[name];
    if (value?.state !== 'concrete') {
      continue;
    }
    const invalid =
      (typeof value.value === 'number' &&
        ((declaration.minimum !== undefined && value.value < declaration.minimum) ||
          (declaration.maximum !== undefined && value.value > declaration.maximum))) ||
      (declaration.allowedValues !== undefined &&
        !declaration.allowedValues.includes(value.value as number | boolean | string));
    if (invalid) {
      resolved[name] = { ...value, state: 'invalid', reason: 'Value violates its declaration.' };
      diagnostics.push({
        code: 'BUS_INTERFACE_PROPERTY_VALUE',
        ruleId: 'BUS_INTERFACE_PROPERTY_VALUE',
        severity: 'error',
        state: 'invalid',
        interfaceName: busInterface.name,
        path: ['busInterfaces', busIndex, 'interfaceProperties', name],
        message: `Interface property '${name}' violates its contract declaration.`,
      });
    }
  }

  return resolved;
}
