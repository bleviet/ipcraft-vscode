import { useCallback, useMemo } from 'react';
import type { BusInterface, Parameter } from '../../../domain/ipcore.types';
import type { DerivedOperation } from '../../../domain/busDefinition.types';
import {
  operationReferences,
  resolveEffectivePortPolarity,
  resolveBusInterface,
  type BusInterfaceResolution,
  type NormalizedBusLibrary,
  type PortPolarity,
  type ResolutionState,
} from '../../../shared/busContracts';
import type { BatchUpdate } from './useGroupPorts';

export interface EditableContractField {
  path: readonly (string | number)[];
  name: string;
  value: number | string | boolean | undefined;
  error?: string;
}

export interface ReadonlyContractField {
  name: string;
  formula: string;
  resolvedValue?: number;
  state: ResolutionState;
}

export interface EditablePolarityField {
  name: string;
  value: PolaritySelection;
  defaultValue: PortPolarity;
  active: boolean;
  error?: string;
}

export type PolaritySelection = 'default' | PortPolarity;

export type BusContractMutation = [Array<string | number>, unknown];

export interface BusContractEditModel {
  rootWidths: readonly EditableContractField[];
  properties: readonly EditableContractField[];
  derivedWidths: readonly ReadonlyContractField[];
  fixedWidths: readonly ReadonlyContractField[];
  polarities: readonly EditablePolarityField[];
}

function operationFormula(operation: DerivedOperation): string {
  const operand =
    'port' in operation ? operation.port : 'property' in operation ? operation.property : 'value';
  switch (operation.operation) {
    case 'divideBy':
      return `${operand} / ${'divisor' in operation ? operation.divisor : operation.divisorProperty}`;
    case 'multiplyBy':
      return `${operand} × ${operation.multiplier}`;
    case 'ceilLog2':
      return `ceil(log2(${operand}))`;
    case 'bitsForMaximum':
      return `bits(${operand})`;
    case 'maxEncodableValue':
      return `2^${operand} - 1`;
    case 'copyPort':
      return operand;
    case 'multiplyProperties':
      return operation.properties.join(' × ');
  }
}

function diagnosticFor(
  resolution: BusInterfaceResolution,
  section: 'portWidthOverrides' | 'interfaceProperties' | 'portPolarityOverrides',
  name: string
): string | undefined {
  return resolution.diagnostics.find(
    (diagnostic) => diagnostic.path.at(-2) === section && diagnostic.path.at(-1) === name
  )?.message;
}

export function buildBusContractEditModel(
  busIndex: number,
  resolution: BusInterfaceResolution
): BusContractEditModel {
  const contract = resolution.match?.contract;
  if (!contract) {
    return { rootWidths: [], properties: [], derivedWidths: [], fixedWidths: [], polarities: [] };
  }
  const busInterface = resolution.canonicalBusInterface;
  const activePortNames = new Set(resolution.activePorts.map((port) => port.name));
  const authoredPolarity = (name: string): { found: boolean; value?: PortPolarity } => {
    let found = false;
    let value: PortPolarity | undefined;
    for (const [key, candidate] of Object.entries(busInterface?.portPolarityOverrides ?? {})) {
      if (key.toLowerCase() !== name.toLowerCase()) {
        continue;
      }
      found = true;
      value = candidate === 'activeHigh' || candidate === 'activeLow' ? candidate : undefined;
    }
    return { found, value };
  };
  const readonlyField = (name: string, formula: string): ReadonlyContractField => {
    const value = resolution.portWidths[name];
    return { name, formula, resolvedValue: value?.value, state: value?.state ?? 'unresolved' };
  };
  return {
    rootWidths: contract.ports
      .filter((port) => port.widthPolicy === 'root')
      .map((port) => ({
        path: ['busInterfaces', busIndex, 'portWidthOverrides', port.name],
        name: port.name,
        value:
          resolution.authoredPortWidths[port.name] ??
          resolution.portWidths[port.name]?.value ??
          port.width,
        error: diagnosticFor(resolution, 'portWidthOverrides', port.name),
      })),
    properties: Object.keys(contract.interfaceProperties).map((name) => ({
      path: ['busInterfaces', busIndex, 'interfaceProperties', name],
      name,
      value: resolution.authoredProperties[name] ?? resolution.properties[name]?.value,
      error: diagnosticFor(resolution, 'interfaceProperties', name),
    })),
    derivedWidths: contract.ports
      .filter((port) => port.widthPolicy === 'derived')
      .map((port) => readonlyField(port.name, operationFormula(port.derivedWidth!))),
    fixedWidths: contract.ports
      .filter((port) => port.widthPolicy === 'fixed')
      .map((port) => readonlyField(port.name, `fixed ${port.width ?? 1}`)),
    polarities: busInterface
      ? contract.ports
          .filter((port) => port.polarity !== undefined)
          .map((port) => {
            const authored = authoredPolarity(port.name);
            return {
              name: port.name,
              value: authored.found
                ? (authored.value ?? resolveEffectivePortPolarity(port, busInterface)!)
                : 'default',
              defaultValue: port.polarity!.default,
              active: activePortNames.has(port.name),
              error: diagnosticFor(resolution, 'portPolarityOverrides', port.name),
            };
          })
      : [],
  };
}

function affectedDerivedPorts(rootPort: string, resolution: BusInterfaceResolution): string[] {
  const contract = resolution.match?.contract;
  if (!contract) {
    return [];
  }
  const ports = new Set([rootPort]);
  const properties = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, declaration] of Object.entries(contract.interfaceProperties)) {
      const derive = declaration.derive;
      const references = derive ? operationReferences(derive, []) : [];
      if (
        derive &&
        !properties.has(name) &&
        references.some((reference) =>
          reference.kind === 'port' ? ports.has(reference.name) : properties.has(reference.name)
        )
      ) {
        properties.add(name);
        changed = true;
      }
    }
    for (const port of contract.ports.filter((candidate) => candidate.widthPolicy === 'derived')) {
      const references = operationReferences(port.derivedWidth!, []);
      if (
        !ports.has(port.name) &&
        references.some((reference) =>
          reference.kind === 'port' ? ports.has(reference.name) : properties.has(reference.name)
        )
      ) {
        ports.add(port.name);
        changed = true;
      }
    }
  }
  ports.delete(rootPort);
  return contract.ports.filter((port) => ports.has(port.name)).map((port) => port.name);
}

export function buildRootWidthMutations(
  busIndex: number,
  portName: string,
  value: number | string,
  resolution: BusInterfaceResolution
): BusContractMutation[] {
  return [
    [['busInterfaces', busIndex, 'portWidthOverrides', portName], value],
    ...affectedDerivedPorts(portName, resolution).map(
      (name): BusContractMutation => [
        ['busInterfaces', busIndex, 'portWidthOverrides', name],
        undefined,
      ]
    ),
  ];
}

export function useBusContractEditor(options: {
  bus: BusInterface;
  busIndex: number;
  parameters: readonly Parameter[];
  busLibrary: NormalizedBusLibrary;
  batchUpdate: BatchUpdate;
}) {
  const { bus, busIndex, parameters, busLibrary, batchUpdate } = options;
  const resolution = useMemo(
    () => resolveBusInterface({ busInterface: bus, busIndex, parameters, library: busLibrary }),
    [bus, busIndex, parameters, busLibrary]
  );
  const model = useMemo(
    () => buildBusContractEditModel(busIndex, resolution),
    [busIndex, resolution]
  );
  const updateRootWidth = useCallback(
    (name: string, value: number | string) =>
      batchUpdate(buildRootWidthMutations(busIndex, name, value, resolution)),
    [batchUpdate, busIndex, resolution]
  );
  const updateProperty = useCallback(
    (name: string, value: number | string | boolean) =>
      batchUpdate([[['busInterfaces', busIndex, 'interfaceProperties', name], value]]),
    [batchUpdate, busIndex]
  );
  const updatePolarity = useCallback(
    (name: string, value: PolaritySelection) => {
      const field = model.polarities.find((candidate) => candidate.name === name);
      if (!field) {
        return;
      }
      const updated = { ...(resolution.canonicalBusInterface?.portPolarityOverrides ?? {}) };
      for (const key of Object.keys(updated)) {
        if (key.toLowerCase() === name.toLowerCase()) {
          delete updated[key];
        }
      }
      if (value !== 'default') {
        updated[name] = value;
      }
      batchUpdate([
        [
          ['busInterfaces', busIndex, 'portPolarityOverrides'],
          Object.keys(updated).length > 0 ? updated : undefined,
        ],
      ]);
    },
    [batchUpdate, busIndex, model.polarities, resolution.canonicalBusInterface]
  );
  return { resolution, model, updateRootWidth, updateProperty, updatePolarity };
}
