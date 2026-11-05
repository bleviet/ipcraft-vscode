/**
 * Vendor-neutral inference over a {@link SystemGraph}: pin directions from
 * connections and names, and net categories from declared types and names.
 * Both functions mutate the given graph in place and return it.
 */

import type {
  NetCategory,
  PinRef,
  SystemGraph,
  SystemNet,
  SystemPin,
} from '../../domain/systemGraph';
import { directionForRole, endpointRole } from '../../domain/systemGraphRoles';

interface Endpoint {
  ref: PinRef;
  pin: SystemPin;
  isBoundary: boolean;
}

function netEndpoints(graph: SystemGraph, net: SystemNet): Endpoint[] {
  const result: Endpoint[] = [];
  for (const ref of net.endpoints) {
    const pins =
      ref.instance === null
        ? graph.levels[net.level]?.boundaryPins
        : graph.instances[ref.instance]?.pins;
    const pin = pins?.find((p) => p.name === ref.pin);
    if (pin) {
      result.push({ ref, pin, isBoundary: ref.instance === null });
    }
  }
  return result;
}

function connectionPass(graph: SystemGraph): boolean {
  let changed = false;
  for (const net of graph.nets) {
    const endpoints = netEndpoints(graph, net);
    const roles = endpoints.map((e) => endpointRole(e.pin.direction, e.isBoundary));
    const unknown = endpoints.filter((e) => e.pin.direction === 'unknown');
    if (unknown.length === 0) {
      continue;
    }
    let role: 'source' | 'sink' | undefined;
    if (roles.includes('source')) {
      role = 'sink';
    } else if (roles.includes('sink') && unknown.length === 1) {
      role = 'source';
    }
    if (!role) {
      continue;
    }
    for (const e of unknown) {
      e.pin.direction = directionForRole(role, net.isInterface, e.isBoundary);
      e.pin.directionSource = 'connection';
      changed = true;
    }
  }
  return changed;
}

function namePass(graph: SystemGraph): void {
  const pinLists = [
    ...Object.values(graph.instances).map((i) => i.pins),
    ...Object.values(graph.levels).map((l) => l.boundaryPins),
  ];
  for (const pins of pinLists) {
    for (const pin of pins) {
      if (!pin.isInterface || pin.direction !== 'unknown') {
        continue;
      }
      if (/^[Mm]\d*_/.test(pin.name)) {
        pin.direction = 'master';
        pin.directionSource = 'name';
      } else if (/^[Ss]\d*_/.test(pin.name)) {
        pin.direction = 'slave';
        pin.directionSource = 'name';
      }
    }
  }
}

/** Fills unknown pin directions: connections, then names, then connections again. */
export function inferPinDirections(graph: SystemGraph): SystemGraph {
  while (connectionPass(graph)) {
    // repeat until no change
  }
  namePass(graph);
  while (connectionPass(graph)) {
    // repeat until no change
  }
  return graph;
}

function interfaceCategory(pins: SystemPin[]): [NetCategory, SystemNet['categorySource']] {
  const vlnvs = pins.map((p) => p.vlnv ?? '');
  if (vlnvs.some((v) => v.includes(':axis_rtl:') || v.includes(':axis:'))) {
    return ['axis', 'declared'];
  }
  if (vlnvs.some((v) => v.includes(':aximm_rtl:') || v.includes(':aximm:'))) {
    return ['aximm', 'declared'];
  }
  const names = pins.map((p) => p.name);
  if (names.some((n) => /axis/i.test(n))) {
    return ['axis', 'name'];
  }
  if (names.some((n) => /axi/i.test(n))) {
    return ['aximm', 'name'];
  }
  return ['interface', 'default'];
}

const DECLARED_SCALAR: Record<string, NetCategory> = {
  clk: 'clock',
  rst: 'reset',
  intr: 'interrupt',
};

function scalarCategory(
  net: SystemNet,
  pins: SystemPin[]
): [NetCategory, SystemNet['categorySource']] {
  for (const pin of pins) {
    const declared = pin.signalType ? DECLARED_SCALAR[pin.signalType] : undefined;
    if (declared) {
      return [declared, 'declared'];
    }
  }
  const names = [net.name, ...pins.map((p) => p.name)];
  const rules: [RegExp, NetCategory][] = [
    [/rst|reset/i, 'reset'],
    [/clk|clock/i, 'clock'],
    [/intr|irq|interrupt/i, 'interrupt'],
  ];
  for (const [pattern, category] of rules) {
    if (names.some((n) => pattern.test(n))) {
      return [category, 'name'];
    }
  }
  return ['signal', 'default'];
}

/** Sets `category` / `categorySource` on every net. */
export function classifyNets(graph: SystemGraph): SystemGraph {
  let classifiedByName = false;
  for (const net of graph.nets) {
    const pins = netEndpoints(graph, net).map((e) => e.pin);
    const [category, source] = net.isInterface
      ? interfaceCategory(pins)
      : scalarCategory(net, pins);
    net.category = category;
    net.categorySource = source;
    if (!net.isInterface && source === 'name') {
      classifiedByName = true;
    }
  }
  if (classifiedByName) {
    graph.diagnostics.push({
      severity: 'info',
      message:
        'Clock, reset, and interrupt nets were partly classified by name because no IP definitions are available.',
    });
  }
  return graph;
}
