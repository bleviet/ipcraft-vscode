/**
 * Connection-kind inference for `qsys-script` Tcl, where `add_connection`
 * usually omits the kind a `.qsys` always states. Pure: rules run in order
 * (explicit kind, connection parameters, propagation along shared endpoints,
 * interface names) and each result records how it was decided.
 */

import type { SystemNet } from '../../domain/systemGraph';

export interface KindConnection {
  /** `instance.interface` as written. */
  start: string;
  end: string;
  /** The explicit third argument of `add_connection`, if any. */
  declared?: string;
  parameters: Record<string, string>;
}

export interface KindExport {
  /** The exported endpoint as written. */
  internal?: string;
  /** The `add_interface` type. */
  type: string;
}

export interface InferredKind {
  /** Connection type; `''` when nothing matched. */
  kind: string;
  kindSource: SystemNet['categorySource'];
}

const interfaceName = (endpoint: string): string => {
  const cut = endpoint.indexOf('.');
  return (cut < 0 ? '' : endpoint.slice(cut + 1)).toLowerCase();
};

const parts = (name: string): string[] => name.split('_');

const hasPart = (name: string, pattern: RegExp): boolean =>
  parts(name).some((part) => pattern.test(part));

/** The one AXI test: interface names only, never instance names. */
const isAxiName = (name: string): boolean => name.includes('axi');

const isMemoryMapped = (name: string): boolean =>
  isAxiName(name) ||
  name.endsWith('_data') ||
  hasPart(name, /^(?:master|slave|manager|agent|avm|avs|[sm]\d+)$/);

/** `axi` only when both interface names indicate AXI (an AXI master on an Avalon slave is `avalon`). */
const memoryMappedKind = (start: string, end: string): string =>
  isAxiName(interfaceName(start)) && isAxiName(interfaceName(end)) ? 'axi' : 'avalon';

const NAME_RULES: ((name: string) => string)[] = [
  (name) => (hasPart(name, /^(?:irq\d*|interrupt)$/) ? 'interrupt' : ''),
  (name) => (hasPart(name, /^(?:reset|rst)\d*$/) ? 'reset' : ''),
  (name) => (hasPart(name, /^(?:clk|clock)\d*$/) ? 'clock' : ''),
];

/** Rule 4: the first rule that matches the start's, then the end's, interface name. */
function kindFromNames(start: string, end: string): string {
  const names = [interfaceName(start), interfaceName(end)];
  for (const rule of NAME_RULES) {
    for (const name of names) {
      const kind = rule(name);
      if (kind) {
        return kind;
      }
    }
  }
  return names.some(isMemoryMapped) ? memoryMappedKind(start, end) : '';
}

/** Rules 1 and 2: the explicit kind, else a kind implied by a connection parameter. */
function kindFromDeclaration(connection: KindConnection): string {
  if (connection.declared) {
    return connection.declared;
  }
  if (connection.parameters.irqNumber !== undefined) {
    return 'interrupt';
  }
  if (connection.parameters.baseAddress !== undefined) {
    return memoryMappedKind(connection.start, connection.end);
  }
  return '';
}

export function inferConnectionKinds(
  connections: readonly KindConnection[],
  interfaces: readonly KindExport[]
): InferredKind[] {
  const result: InferredKind[] = connections.map((connection) => {
    const kind = kindFromDeclaration(connection);
    return { kind, kindSource: kind ? 'declared' : 'default' };
  });

  const endpointTypes = new Map<string, string>();
  for (const exported of interfaces) {
    if (exported.internal && exported.type) {
      endpointTypes.set(exported.internal, exported.type);
    }
  }
  const learn = (): void => {
    connections.forEach((connection, i) => {
      if (result[i].kind) {
        endpointTypes.set(connection.start, endpointTypes.get(connection.start) ?? result[i].kind);
        endpointTypes.set(connection.end, endpointTypes.get(connection.end) ?? result[i].kind);
      }
    });
  };
  learn();
  for (let changed = true; changed; ) {
    changed = false;
    connections.forEach((connection, i) => {
      const known = endpointTypes.get(connection.start) ?? endpointTypes.get(connection.end);
      if (!result[i].kind && known) {
        result[i] = { kind: known, kindSource: 'declared' };
        changed = true;
      }
    });
    learn();
  }

  connections.forEach((connection, i) => {
    if (!result[i].kind) {
      const kind = kindFromNames(connection.start, connection.end);
      result[i] = { kind, kindSource: kind ? 'name' : 'default' };
    }
  });
  return result;
}
