import type { BusInterface } from '../../domain/ipcore.types';
import { buildActivePorts, isPortActive } from './activePorts';
import { canonicalizeBusType, normalizeInterfaceMode } from './canonicalize';
import { evaluateContractConstraints } from './constraintEvaluation';
import { deriveOperation, resolveToFixpoint, sameResolution } from './derivation';
import { createParameterContext, expressionsEqual, resolveNumericValue } from './expression';
import { resolveProperties } from './propertyResolution';
import { canonicalizeBusInterfacePorts } from './polarity';
import type {
  BusConformanceDiagnostic,
  BusDefinitionContract,
  BusInterfaceResolution,
  NormalizedBusPort,
  ResolveBusInterfaceInput,
  ResolvedNumericValue,
} from './types';

function freezeResolution(result: BusInterfaceResolution): BusInterfaceResolution {
  Object.freeze(result.authoredPortWidths);
  Object.freeze(result.authoredProperties);
  Object.freeze(result.portWidths);
  Object.freeze(result.properties);
  Object.freeze(result.diagnostics);
  return Object.freeze(result);
}

function emptyResolution(): BusInterfaceResolution {
  return freezeResolution({
    match: null,
    canonicalBusInterface: null,
    normalizedMode: null,
    authoredPortWidths: {},
    authoredProperties: {},
    portWidths: {},
    properties: {},
    activePorts: Object.freeze([]),
    diagnostics: [],
  });
}

function equivalent(left: ResolvedNumericValue, right: ResolvedNumericValue): boolean {
  if (left.state === 'concrete' && right.state === 'concrete') {
    return left.value === right.value;
  }
  return expressionsEqual(left.expression, right.expression);
}

function policyDiagnostic(
  code: 'BUS_DERIVED_WIDTH_OVERRIDE' | 'BUS_FIXED_WIDTH_OVERRIDE',
  busInterface: BusInterface,
  busIndex: number,
  portName: string,
  expected: ResolvedNumericValue
): BusConformanceDiagnostic {
  return {
    code,
    ruleId: code,
    severity: 'error',
    state: 'invalid',
    interfaceName: busInterface.name,
    path: ['busInterfaces', busIndex, 'portWidthOverrides', portName],
    message: `${portName} must match its ${code === 'BUS_FIXED_WIDTH_OVERRIDE' ? 'fixed' : 'derived'} contract width.`,
    ...(expected.value !== undefined ? { suggestedValue: expected.value } : {}),
  };
}

function linkedOverrideDiagnostic(
  contract: BusDefinitionContract,
  port: NormalizedBusPort,
  busInterface: BusInterface,
  busIndex: number,
  expected: ResolvedNumericValue
): BusConformanceDiagnostic | null {
  if (!port.overrideConstraintRuleId) {
    return null;
  }
  const constraint = contract.constraints.find(
    (candidate) => candidate.ruleId === port.overrideConstraintRuleId
  );
  if (!constraint) {
    return null;
  }
  return {
    code: constraint.code,
    ruleId: constraint.ruleId,
    severity: constraint.severity,
    state: 'invalid',
    interfaceName: busInterface.name,
    path: ['busInterfaces', busIndex, 'portWidthOverrides', port.name],
    message: constraint.message ?? `${constraint.ruleId} is not satisfied.`,
    ...(expected.value !== undefined ? { suggestedValue: expected.value } : {}),
  };
}

function polarityOverrideDiagnostic(
  busInterface: BusInterface,
  busIndex: number,
  portName: string
): BusConformanceDiagnostic {
  return {
    code: 'BUS_PORT_POLARITY_OVERRIDE',
    ruleId: 'BUS_PORT_POLARITY_OVERRIDE',
    severity: 'error',
    state: 'invalid',
    interfaceName: busInterface.name,
    path: ['busInterfaces', busIndex, 'portPolarityOverrides', portName],
    message: `Port polarity override '${portName}' is not declared by this bus contract.`,
  };
}

export function resolveBusInterface(input: ResolveBusInterfaceInput): BusInterfaceResolution {
  const match = canonicalizeBusType(input.busInterface.type, input.library);
  if (!match) {
    return emptyResolution();
  }

  const { contract } = match;
  const { busInterface: canonicalBusInterface } = canonicalizeBusInterfacePorts(
    contract,
    input.busInterface,
    input.busIndex
  );
  const diagnostics: BusConformanceDiagnostic[] = [];
  const normalizedMode = normalizeInterfaceMode(contract, canonicalBusInterface.mode);
  if (!normalizedMode) {
    diagnostics.push({
      code: 'BUS_INTERFACE_MODE',
      ruleId: 'BUS_INTERFACE_MODE',
      severity: 'error',
      state: 'invalid',
      interfaceName: canonicalBusInterface.name,
      path: ['busInterfaces', input.busIndex, 'mode'],
      message: `Mode '${canonicalBusInterface.mode}' is not declared by ${contract.canonicalVlnv}.`,
    });
  }

  const context = createParameterContext(input.parameters);
  const overrides = canonicalBusInterface.portWidthOverrides ?? {};
  const portWidths: Record<string, ResolvedNumericValue> = {};

  for (const port of contract.ports) {
    const rawValue =
      port.widthPolicy === 'root' && Object.prototype.hasOwnProperty.call(overrides, port.name)
        ? overrides[port.name]
        : (port.width ?? 1);
    portWidths[port.name] = resolveNumericValue(rawValue, context);
  }

  const properties = resolveProperties(
    contract,
    canonicalBusInterface,
    portWidths,
    context,
    input.busIndex,
    diagnostics
  );

  resolveToFixpoint(contract.ports.length, () => {
    let changed = false;
    for (const port of contract.ports) {
      if (port.widthPolicy !== 'derived' || !port.derivedWidth) {
        continue;
      }
      const next = deriveOperation(port.derivedWidth, portWidths, properties, context, 1);
      if (!sameResolution(next, portWidths[port.name])) {
        portWidths[port.name] = next;
        changed = true;
      }
    }
    return changed;
  });

  for (const port of contract.ports) {
    if (port.widthPolicy === 'root') {
      continue;
    }
    if (!isPortActive(port, canonicalBusInterface)) {
      continue;
    }
    const expected = portWidths[port.name];
    if (!Object.prototype.hasOwnProperty.call(overrides, port.name)) {
      continue;
    }
    const authored = resolveNumericValue(overrides[port.name], context);
    if (!equivalent(authored, expected)) {
      const code =
        port.widthPolicy === 'fixed' ? 'BUS_FIXED_WIDTH_OVERRIDE' : 'BUS_DERIVED_WIDTH_OVERRIDE';
      diagnostics.push(
        policyDiagnostic(code, canonicalBusInterface, input.busIndex, port.name, expected)
      );
      const linked = linkedOverrideDiagnostic(
        contract,
        port,
        canonicalBusInterface,
        input.busIndex,
        expected
      );
      if (linked) {
        diagnostics.push(linked);
      }
    }
    portWidths[port.name] = authored;
  }

  for (const [portName, polarity] of Object.entries(
    canonicalBusInterface.portPolarityOverrides ?? {}
  )) {
    const port = contract.ports.find(
      (candidate) => candidate.name.toLowerCase() === portName.toLowerCase()
    );
    if (!port?.polarity || (polarity !== 'activeHigh' && polarity !== 'activeLow')) {
      diagnostics.push(polarityOverrideDiagnostic(canonicalBusInterface, input.busIndex, portName));
    }
  }

  const activePorts = buildActivePorts(contract, canonicalBusInterface, normalizedMode, portWidths);
  const activePortNames = new Set(activePorts.map((port) => port.name));

  for (const port of contract.ports) {
    const width = portWidths[port.name];
    if (
      activePortNames.has(port.name) &&
      width.state === 'invalid' &&
      !diagnostics.some((item) => item.path.at(-1) === port.name)
    ) {
      diagnostics.push({
        code: 'BUS_PORT_WIDTH_INVALID',
        ruleId: 'BUS_PORT_WIDTH_INVALID',
        severity: 'error',
        state: 'invalid',
        interfaceName: canonicalBusInterface.name,
        path: ['busInterfaces', input.busIndex, 'portWidthOverrides', port.name],
        message: width.reason ?? `Port '${port.name}' has an invalid width.`,
      });
    }
  }

  diagnostics.push(
    ...evaluateContractConstraints({
      contract,
      busInterface: canonicalBusInterface,
      busIndex: input.busIndex,
      parameters: input.parameters,
      parameterContext: context,
      portWidths,
      properties,
      activePorts,
    })
  );

  return freezeResolution({
    match,
    canonicalBusInterface,
    normalizedMode,
    authoredPortWidths: { ...overrides },
    authoredProperties: { ...(canonicalBusInterface.interfaceProperties ?? {}) },
    portWidths,
    properties,
    activePorts,
    diagnostics,
  });
}
