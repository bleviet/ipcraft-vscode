/**
 * Clock domains: every clock physical net belongs to one, and a clock-forwarding
 * block (Platform Designer `clock_source`) joins its input's and output's nets
 * into one. A domain's frequency comes only from values the script sets (rules
 * in `clockRules.ts`); otherwise it is unknown.
 */

import type {
  PinRef,
  SystemGraph,
  SystemInstance,
  SystemNet,
  SystemPin,
} from '../../../domain/systemGraph';
import { endpointKey, netDriver, netsByEndpoint, pinRole, resolvePin } from '../model';
import type { ClockDomain, FrequencyOrigin } from './clockTypes';
import {
  boundaryFrequency,
  passThroughOf,
  sourceFrequency,
  type RuleFrequency,
} from './clockRules';
import type { PhysicalNet, PhysicalNets, PinEnd } from './physicalNets';
import { UnionFind } from './unionFind';

/** Domain colors in creation order, cycling. */
export const DOMAIN_COLORS: readonly string[] = [
  'var(--vscode-charts-blue)',
  'var(--vscode-charts-purple)',
  'var(--vscode-terminal-ansiCyan)',
  'var(--vscode-terminal-ansiMagenta)',
  'var(--vscode-charts-green)',
  'var(--vscode-charts-orange)',
];

type NetLookup = ReadonlyMap<string, readonly SystemNet[]>;

/**
 * Clock input pins of an instance: pins declared as clocks and the pins that
 * load a clock net (every endpoint but its driver), never an output. `lookup`
 * holds the nets of the level the instance is seen on.
 */
function clockInputPins(
  graph: SystemGraph,
  instance: SystemInstance,
  lookup: NetLookup
): SystemPin[] {
  return instance.pins.filter((pin) => {
    if (pinRole(pin, false) === 'source') {
      return false;
    }
    if (pin.signalType === 'clk') {
      return true;
    }
    const nets = lookup.get(endpointKey({ instance: instance.path, pin: pin.name })) ?? [];
    return nets.some((net) => {
      const driver = netDriver(graph, net);
      return (
        net.category === 'clock' && !(driver?.instance === instance.path && driver.pin === pin.name)
      );
    });
  });
}

export interface ClockDomains {
  domains: readonly ClockDomain[];
  domainOfNet: (netId: string) => ClockDomain | undefined;
  domainOfPin: (level: string, ref: PinRef) => ClockDomain | undefined;
  clockInputs: (instancePath: string) => SystemPin[];
  /** Distinct domains of the instance's clock inputs, in domain order. */
  instanceDomains: (instancePath: string) => ClockDomain[];
}

interface Forwarder {
  instance: SystemInstance;
  input: number;
  output: number;
}

function origin(
  found: RuleFrequency,
  kind: FrequencyOrigin['kind'],
  owner: string,
  level: string,
  line: number | undefined
): FrequencyOrigin {
  return {
    parameter: found.parameter,
    value: found.value,
    text: `${found.parameter} = ${found.value}`,
    kind,
    owner,
    level,
    ...(line !== undefined && { line }),
  };
}

/** Frequency of a domain: the source pin's rule, then a forwarding block's rule, then `CONFIG.FREQ_HZ` on a boundary pin of the domain. */
function domainFrequency(
  graph: SystemGraph,
  source: PinEnd,
  forwarders: readonly Forwarder[],
  nets: readonly SystemNet[]
): { hz: number; from: FrequencyOrigin } | undefined {
  const sourceInstance = source.instance === null ? undefined : graph.instances[source.instance];
  const sourcePin = resolvePin(graph, source.level, source);
  const own = sourceInstance
    ? sourceFrequency(sourceInstance, source.pin)
    : sourcePin && boundaryFrequency(sourcePin);
  if (own) {
    const from = sourceInstance
      ? origin(own, 'script', sourceInstance.name, sourceInstance.parent, sourceInstance.line)
      : origin(own, 'declared', source.pin, source.level, sourcePin?.line);
    return { hz: own.hz, from };
  }
  for (const { instance } of forwarders) {
    const output = passThroughOf(instance)?.output;
    const found = output === undefined ? undefined : sourceFrequency(instance, output);
    if (found) {
      return {
        hz: found.hz,
        from: origin(found, 'script', instance.name, instance.parent, instance.line),
      };
    }
  }
  for (const net of nets) {
    for (const ref of net.endpoints) {
      if (ref.instance !== null && graph.instances[ref.instance]?.kind !== 'hier') {
        continue;
      }
      const pin = resolvePin(graph, net.level, ref);
      const found = pin && boundaryFrequency(pin);
      if (found) {
        return {
          hz: found.hz,
          from: origin(found, 'declared', pin.name, ref.instance ?? net.level, pin.line),
        };
      }
    }
  }
  return undefined;
}

/**
 * Clock physical nets grouped into domains: nets joined by a clock-forwarding
 * block share a group. `derived` holds the nets a forwarder drives.
 */
function forwardingGroups(
  graph: SystemGraph,
  physical: PhysicalNets,
  clockNets: readonly PhysicalNet[]
): { groups: number[][]; forwarders: Forwarder[]; derived: Set<number> } {
  const position = new Map(clockNets.map((net, index) => [net.id, index]));
  const at = (level: string, ref: PinRef): number | undefined => {
    const net = physical.ofPin(level, ref);
    return net && position.get(net.id);
  };
  const sets = new UnionFind(clockNets.length);
  const forwarders: Forwarder[] = [];
  for (const instance of Object.values(graph.instances)) {
    const rule = instance.kind === 'hier' ? undefined : passThroughOf(instance);
    const input = rule && at(instance.parent, { instance: instance.path, pin: rule.input });
    const output = rule && at(instance.parent, { instance: instance.path, pin: rule.output });
    if (input !== undefined && output !== undefined) {
      sets.union(input, output);
      forwarders.push({ instance, input, output });
    }
  }
  const byRoot = new Map<number, number[]>();
  clockNets.forEach((_net, index) => {
    const root = sets.find(index);
    const group = byRoot.get(root);
    if (group) {
      group.push(index);
    } else {
      byRoot.set(root, [index]);
    }
  });
  return {
    groups: [...byRoot.values()],
    forwarders,
    derived: new Set(forwarders.map((forwarder) => forwarder.output)),
  };
}

/** Domains with a clock pin sharing a name get the longer `instanceName/pin` as their name. */
function disambiguateNames(domains: readonly ClockDomain[]): void {
  const count = new Map<string, number>();
  for (const domain of domains) {
    count.set(domain.name, (count.get(domain.name) ?? 0) + 1);
  }
  for (const domain of domains) {
    if ((count.get(domain.name) ?? 0) > 1) {
      domain.name = domain.label;
    }
  }
}

export function buildClockDomains(graph: SystemGraph, physical: PhysicalNets): ClockDomains {
  const clockNets = physical.nets.filter((net) => net.nets.some((n) => n.category === 'clock'));
  const { groups, forwarders, derived } = forwardingGroups(graph, physical, clockNets);
  const netOrder = new Map(graph.nets.map((net, index) => [net.id, index]));
  const byPhysical = new Map<string, ClockDomain>();
  const domains: ClockDomain[] = [];
  for (const members of groups) {
    const hasDriver = (index: number) => clockNets[index].driver !== undefined;
    // The source is the driver of the group's upstream-most net, not of a net a forwarder drives.
    const sourceIndex =
      members.find((index) => !derived.has(index) && hasDriver(index)) ?? members.find(hasDriver);
    const sourceNet = sourceIndex === undefined ? undefined : clockNets[sourceIndex];
    const source = sourceNet?.driver;
    if (!sourceNet || !source) {
      continue;
    }
    const physicalNets = members.map((index) => clockNets[index]);
    const nets = physicalNets
      .flatMap((net) => net.nets)
      .sort((a, b) => (netOrder.get(a.id) ?? 0) - (netOrder.get(b.id) ?? 0));
    const sourceInstance = source.instance === null ? undefined : graph.instances[source.instance];
    const frequency = domainFrequency(
      graph,
      source,
      forwarders.filter((forwarder) => members.includes(forwarder.output)),
      nets
    );
    const index = domains.length;
    const line = sourceInstance
      ? sourceInstance.line
      : resolvePin(graph, source.level, source)?.line;
    const domain: ClockDomain = {
      id: `clock:${index}`,
      index,
      name: source.pin,
      label: sourceInstance ? `${sourceInstance.name}/${source.pin}` : source.pin,
      sourceLevel: source.level,
      sourceRef: { instance: source.instance, pin: source.pin },
      sourceNetId: sourceNet.driverNet?.id ?? sourceNet.nets[0].id,
      ...(frequency && { hz: frequency.hz, frequencyFrom: frequency.from }),
      ...(line !== undefined && { line }),
      netIds: nets.map((net) => net.id),
      loads: physicalNets.reduce((sum, net) => sum + net.ends.length - (net.driver ? 1 : 0), 0),
      levels: new Set(nets.map((net) => net.level)).size,
      color: DOMAIN_COLORS[index % DOMAIN_COLORS.length],
    };
    domains.push(domain);
    for (const net of physicalNets) {
      byPhysical.set(net.id, domain);
    }
  }
  disambiguateNames(domains);

  const lookups = new Map<string, NetLookup>();
  const inputCache = new Map<string, SystemPin[]>();
  const domainOfPin = (level: string, ref: PinRef) => {
    const net = physical.ofPin(level, ref);
    return net && byPhysical.get(net.id);
  };
  const clockInputs = (instancePath: string): SystemPin[] => {
    const instance = graph.instances[instancePath];
    if (!instance) {
      return [];
    }
    let inputs = inputCache.get(instancePath);
    if (!inputs) {
      let lookup = lookups.get(instance.parent);
      if (!lookup) {
        lookup = netsByEndpoint(graph, instance.parent);
        lookups.set(instance.parent, lookup);
      }
      inputs = clockInputPins(graph, instance, lookup);
      inputCache.set(instancePath, inputs);
    }
    return inputs;
  };
  return {
    domains,
    domainOfNet: (netId) => {
      const net = physical.ofNet(netId);
      return net && byPhysical.get(net.id);
    },
    domainOfPin,
    clockInputs,
    instanceDomains: (instancePath) => {
      const instance = graph.instances[instancePath];
      const found = new Set<ClockDomain>();
      for (const pin of clockInputs(instancePath)) {
        const domain =
          instance && domainOfPin(instance.parent, { instance: instancePath, pin: pin.name });
        if (domain) {
          found.add(domain);
        }
      }
      return [...found].sort((a, b) => a.index - b.index);
    },
  };
}

/** Clock input pins of an instance (declared clocks and loads of clock nets, never outputs). */
export function clockInputs(graph: SystemGraph, instancePath: string): SystemPin[] {
  const instance = graph.instances[instancePath];
  return instance ? clockInputPins(graph, instance, netsByEndpoint(graph, instance.parent)) : [];
}
