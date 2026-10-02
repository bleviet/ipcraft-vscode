import type { DerivedOperation } from '../../domain/busDefinition.types';
import type { DocumentPath, NormalizedBusConstraint } from './types';

export interface DependencyReference {
  node: string;
  kind: 'port' | 'property';
  name: string;
  path: DocumentPath;
}

function reference(
  kind: DependencyReference['kind'],
  name: string,
  path: DocumentPath
): DependencyReference {
  return { node: `${kind}:${name}`, kind, name, path };
}

export function operationReferences(
  operation: DerivedOperation,
  path: DocumentPath
): DependencyReference[] {
  const references: DependencyReference[] = [];
  if ('port' in operation && operation.port) {
    references.push(reference('port', operation.port, [...path, 'port']));
  }
  if ('property' in operation && operation.property) {
    references.push(reference('property', operation.property, [...path, 'property']));
  }
  if ('divisorProperty' in operation && operation.divisorProperty) {
    references.push(reference('property', operation.divisorProperty, [...path, 'divisorProperty']));
  }
  if ('properties' in operation) {
    operation.properties.forEach((name, index) => {
      references.push(reference('property', name, [...path, 'properties', index]));
    });
  }
  return references;
}

export function constraintReferences(
  constraint: NormalizedBusConstraint,
  path: DocumentPath
): DependencyReference[] {
  const references: DependencyReference[] = [];
  if ('port' in constraint && constraint.port) {
    references.push(reference('port', constraint.port, [...path, 'port']));
  }
  if (constraint.kind === 'portWidthQuotient') {
    references.push(reference('port', constraint.dividendPort, [...path, 'dividendPort']));
  }
  if (constraint.kind === 'portWidthsEqual') {
    constraint.ports.forEach((name, index) => {
      references.push(reference('port', name, [...path, 'ports', index]));
    });
  }
  if (constraint.kind === 'portPresenceRequires') {
    constraint.requires.forEach((name, index) => {
      references.push(reference('port', name, [...path, 'requires', index]));
    });
  }
  if ('property' in constraint && constraint.property) {
    references.push(reference('property', constraint.property, [...path, 'property']));
  }
  if (constraint.kind === 'productEqualsPort') {
    constraint.properties.forEach((name, index) => {
      references.push(reference('property', name, [...path, 'properties', index]));
    });
  }
  return references;
}

export function hasDependencyCycle(graph: ReadonlyMap<string, readonly string[]>): boolean {
  const states = new Map<string, 'visiting' | 'visited'>();
  const visit = (node: string): boolean => {
    const state = states.get(node);
    if (state === 'visiting') {
      return true;
    }
    if (state === 'visited') {
      return false;
    }
    states.set(node, 'visiting');
    for (const dependency of graph.get(node) ?? []) {
      if (visit(dependency)) {
        return true;
      }
    }
    states.set(node, 'visited');
    return false;
  };
  return [...graph.keys()].some((node) => visit(node));
}
