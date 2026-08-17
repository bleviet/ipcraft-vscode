import type { BusDefinitionEntry } from '../../domain/busDefinition.types';
import type {
  BusDefinitionContract,
  BusDefinitionSource,
  BusLibraryDiagnostic,
  NormalizedBusAlias,
  NormalizedBusLibrary,
  NormalizedBusPort,
  NormalizedPropertyDeclaration,
} from './types';
import { busAliasIdentity, normalizeBusAlias } from './aliases';
import {
  constraintReferences,
  hasDependencyCycle,
  operationReferences,
  type DependencyReference,
} from './dependencies';
import { normalizeModePolicy } from './modePolicy';
import {
  addLibraryDiagnostic as diagnostic,
  busDisplayName,
  canonicalVlnv,
  cloneAndFreeze,
  normalizePort,
  normalizeProperty,
} from './normalizeValues';

const DERIVED_OPERATIONS = new Set([
  'copyPort',
  'multiplyBy',
  'divideBy',
  'multiplyProperties',
  'ceilLog2',
  'bitsForMaximum',
  'maxEncodableValue',
]);

interface NormalizedEntry {
  contract: BusDefinitionContract;
  aliases: readonly NormalizedBusAlias[];
}

function normalizeEntry(
  key: string,
  entry: BusDefinitionEntry,
  source: BusDefinitionSource,
  diagnostics: BusLibraryDiagnostic[]
): NormalizedEntry | null {
  const errorsBefore = diagnostics.filter((item) => item.severity === 'error').length;
  const canonical = canonicalVlnv(entry);
  if (!canonical || !Array.isArray(entry.ports)) {
    diagnostic(
      diagnostics,
      source.sourceFile,
      'BUS_DEF_MALFORMED_CONTRACT',
      'error',
      [key],
      `Bus definition '${key}' is missing valid busType metadata or ports.`
    );
    return null;
  }

  const modePolicy = normalizeModePolicy(entry.contract);
  if (!modePolicy) {
    diagnostic(
      diagnostics,
      source.sourceFile,
      'BUS_DEF_INVALID_MODE_POLICY',
      'error',
      [key, 'contract', 'modePolicy'],
      `Bus definition '${key}' has an invalid mode policy.`
    );
  }

  const ports: NormalizedBusPort[] = [];
  const portNames = new Set<string>();
  entry.ports.forEach((port, index) => {
    const normalized = normalizePort(port, key, index, source.sourceFile, diagnostics);
    if (!normalized) {
      return;
    }
    if (portNames.has(normalized.name)) {
      diagnostic(
        diagnostics,
        source.sourceFile,
        'BUS_DEF_DUPLICATE_PORT',
        'error',
        [key, 'ports', index, 'name'],
        `Port '${normalized.name}' is declared more than once.`
      );
      return;
    }
    portNames.add(normalized.name);
    ports.push(normalized);
  });

  const portRoleOwners = new Map<string, string>();
  for (const port of ports) {
    portRoleOwners.set(port.name.toLowerCase(), port.name);
  }
  entry.ports.forEach((port, index) => {
    const normalized = ports.find((candidate) => candidate.name === port.name);
    if (!normalized?.polarity) {
      return;
    }
    for (const role of ['activeHigh', 'activeLow'] as const) {
      const name = normalized.polarity.roles[role];
      const owner = portRoleOwners.get(name.toLowerCase());
      if (owner !== undefined && owner !== normalized.name) {
        diagnostic(
          diagnostics,
          source.sourceFile,
          'BUS_DEF_PORT_ROLE_COLLISION',
          'error',
          [key, 'ports', index, 'polarity', 'roles', role],
          `Port polarity role '${name}' collides with '${owner}'.`
        );
        continue;
      }
      portRoleOwners.set(name.toLowerCase(), normalized.name);
    }
  });

  const properties: Record<string, NormalizedPropertyDeclaration> = {};
  for (const [name, declaration] of Object.entries(entry.contract?.interfaceProperties ?? {})) {
    const normalized = normalizeProperty(declaration);
    if (!normalized) {
      diagnostic(
        diagnostics,
        source.sourceFile,
        'BUS_DEF_INVALID_PROPERTY',
        'error',
        [key, 'contract', 'interfaceProperties', name],
        `Interface property '${name}' has an invalid declaration.`
      );
    } else {
      properties[name] = normalized;
    }
  }
  const propertyNames = new Set(Object.keys(properties));

  const graph = new Map<string, readonly string[]>();
  const validateReferences = (references: readonly DependencyReference[]): void => {
    for (const reference of references) {
      const declared =
        reference.kind === 'port'
          ? portNames.has(reference.name)
          : propertyNames.has(reference.name);
      if (!declared) {
        diagnostic(
          diagnostics,
          source.sourceFile,
          reference.kind === 'port' ? 'BUS_DEF_UNDECLARED_PORT' : 'BUS_DEF_UNDECLARED_PROPERTY',
          'error',
          reference.path,
          `Derived contract operand references undeclared ${reference.kind} '${reference.name}'.`
        );
      }
    }
  };

  entry.ports.forEach((port, index) => {
    if (!port.derivedWidth) {
      return;
    }
    if (!DERIVED_OPERATIONS.has(port.derivedWidth.operation)) {
      diagnostic(
        diagnostics,
        source.sourceFile,
        'BUS_DEF_INVALID_DERIVATION',
        'error',
        [key, 'ports', index, 'derivedWidth', 'operation'],
        `Unknown derivation operation '${port.derivedWidth.operation}'.`
      );
      return;
    }
    const references = operationReferences(port.derivedWidth, [
      key,
      'ports',
      index,
      'derivedWidth',
    ]);
    validateReferences(references);
    graph.set(
      `port:${port.name}`,
      references.map((reference) => reference.node)
    );
  });

  for (const [name, declaration] of Object.entries(entry.contract?.interfaceProperties ?? {})) {
    if (!declaration.derive) {
      continue;
    }
    if (!DERIVED_OPERATIONS.has(declaration.derive.operation)) {
      diagnostic(
        diagnostics,
        source.sourceFile,
        'BUS_DEF_INVALID_DERIVATION',
        'error',
        [key, 'contract', 'interfaceProperties', name, 'derive', 'operation'],
        `Unknown derivation operation '${declaration.derive.operation}'.`
      );
      continue;
    }
    const references = operationReferences(declaration.derive, [
      key,
      'contract',
      'interfaceProperties',
      name,
      'derive',
    ]);
    validateReferences(references);
    graph.set(
      `property:${name}`,
      references.map((reference) => reference.node)
    );
  }

  const constraints = entry.contract?.constraints ?? [];
  constraints.forEach((constraint, index) => {
    validateReferences(constraintReferences(constraint, [key, 'contract', 'constraints', index]));
  });
  for (const [index, port] of ports.entries()) {
    if (
      port.overrideConstraintRuleId &&
      !constraints.some((constraint) => constraint.ruleId === port.overrideConstraintRuleId)
    ) {
      diagnostic(
        diagnostics,
        source.sourceFile,
        'BUS_DEF_UNDECLARED_CONSTRAINT',
        'error',
        [key, 'ports', index, 'overrideConstraintRuleId'],
        `Port '${port.name}' references undeclared constraint '${port.overrideConstraintRuleId}'.`
      );
    }
  }

  if (hasDependencyCycle(graph)) {
    diagnostic(
      diagnostics,
      source.sourceFile,
      'BUS_DEF_DERIVATION_CYCLE',
      'error',
      [key, 'contract', 'interfaceProperties'],
      `Bus definition '${key}' contains a circular derivation.`
    );
  }

  const aliases: NormalizedBusAlias[] = [];
  (entry.aliases ?? []).forEach((alias, index) => {
    const normalized = normalizeBusAlias(alias, canonical);
    if (!normalized) {
      diagnostic(
        diagnostics,
        source.sourceFile,
        'BUS_DEF_INVALID_ALIAS',
        'error',
        [key, 'aliases', index],
        `Bus definition '${key}' contains an invalid alias.`
      );
    } else {
      aliases.push(normalized);
    }
  });

  const errorsAfter = diagnostics.filter((item) => item.severity === 'error').length;
  if (errorsAfter > errorsBefore || !modePolicy) {
    return null;
  }

  const contract: BusDefinitionContract = cloneAndFreeze({
    version: entry.contract?.version ?? null,
    key,
    canonicalVlnv: canonical,
    displayName: busDisplayName(entry),
    interfaceKind: entry.contract?.interfaceKind ?? 'conduit',
    modePolicy,
    ports,
    interfaceProperties: properties,
    constraints,
    sourceFile: source.sourceFile,
    sourceKind: source.sourceKind,
    ...(entry.source ? { artifactSource: entry.source } : {}),
  });
  return { contract, aliases: cloneAndFreeze(aliases) };
}

export function normalizeBusLibrary(inputs: readonly BusDefinitionSource[]): NormalizedBusLibrary {
  const definitions: Record<string, BusDefinitionContract> = {};
  const aliases: NormalizedBusAlias[] = [];
  const diagnostics: BusLibraryDiagnostic[] = [];
  const aliasOwners = new Map<string, string>();

  for (const source of inputs) {
    for (const [key, entry] of Object.entries(source.definitions)) {
      const normalized = normalizeEntry(key, entry, source, diagnostics);
      if (!normalized) {
        continue;
      }

      let collision = false;
      normalized.aliases.forEach((alias, index) => {
        const identity = busAliasIdentity(alias);
        const owner = aliasOwners.get(identity);
        if (owner !== undefined && owner !== normalized.contract.canonicalVlnv) {
          collision = true;
          diagnostic(
            diagnostics,
            source.sourceFile,
            'BUS_DEF_ALIAS_COLLISION',
            'error',
            [key, 'aliases', index],
            `Alias '${identity}' is already assigned to '${owner}'.`
          );
        }
      });
      if (collision) {
        continue;
      }

      definitions[key] = normalized.contract;
      for (const alias of normalized.aliases) {
        const identity = busAliasIdentity(alias);
        aliasOwners.set(identity, normalized.contract.canonicalVlnv);
        if (!aliases.some((existing) => busAliasIdentity(existing) === identity)) {
          aliases.push(alias);
        }
      }
    }
  }

  return cloneAndFreeze({ definitions, aliases, diagnostics });
}
