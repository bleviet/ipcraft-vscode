/**
 * Reset sources: every reset physical net is one. A rule says which clock
 * releases the driver (or that it is asynchronous); an external reset port is
 * released on the clock port that lists it in `CONFIG.ASSOCIATED_RESET`. No rule
 * means unknown: neither asynchronous nor tied to a domain. A net with no known
 * driver is still a source, named after its first net, with every pin a sink.
 */

import type { PinRef, SystemGraph } from '../../../domain/systemGraph';
import { resetRelease } from './clockRules';
import type { ClockDomains } from './clockDomains';
import type { PinClocks } from './pinClocks';
import type { ClockDomain, ResetSource } from './clockTypes';
import { endKey, type PhysicalNet, type PhysicalNets } from './physicalNets';

export interface ResetSources {
  resets: readonly ResetSource[];
  /** The physical net each reset source drives. */
  trees: ReadonlyMap<ResetSource, PhysicalNet>;
  resetOfNet: (netId: string) => ResetSource | undefined;
  resetOfPin: (level: string, ref: PinRef) => ResetSource | undefined;
}

export function buildResetSources(
  graph: SystemGraph,
  physical: PhysicalNets,
  model: ClockDomains,
  pinClocks: PinClocks
): ResetSources {
  const resets: ResetSource[] = [];
  const byPhysical = new Map<string, ResetSource>();
  const trees = new Map<ResetSource, PhysicalNet>();
  for (const net of physical.nets) {
    const { driver, driverNet } = net;
    if (net.ends.length === 0 || !net.nets.some((member) => member.category === 'reset')) {
      continue;
    }
    const first = net.nets[0];
    const instance =
      driver && driver.instance !== null ? graph.instances[driver.instance] : undefined;
    let async = false;
    let constant = false;
    let domain: ClockDomain | undefined;
    let from: string | undefined;
    if (driver && instance) {
      const release = resetRelease(instance, driver.pin);
      async = release?.async ?? false;
      constant = release?.constant ?? false;
      from = release?.from;
      if (release?.clockPin !== undefined) {
        domain = model.domainOfPin(driver.level, {
          instance: instance.path,
          pin: release.clockPin,
        });
      }
    } else if (driver) {
      const clock = pinClocks.clockOfPin(driver.level, { instance: null, pin: driver.pin });
      domain = clock?.domain;
      from = clock?.knownFrom;
    }
    const index = resets.length;
    const holder = driverNet ?? first;
    const source: ResetSource = {
      id: `reset:${index}`,
      index,
      label: driver ? (instance ? `${instance.name}/${driver.pin}` : driver.pin) : first.name,
      ...(driver && { source: driver }),
      level: driver?.level ?? first.level,
      netId: holder.id,
      async,
      ...(constant && { constant: true as const }),
      ...(domain && { domain }),
      ...(from !== undefined && { from }),
      line: holder.line,
      netIds: net.nets.map((member) => member.id),
      sinks: net.ends.filter((end) => !driver || endKey(end) !== endKey(driver)),
    };
    resets.push(source);
    byPhysical.set(net.id, source);
    trees.set(source, net);
  }
  return {
    resets,
    trees,
    resetOfNet: (netId) => {
      const net = physical.ofNet(netId);
      return net && byPhysical.get(net.id);
    },
    resetOfPin: (level, ref) => {
      const net = physical.ofPin(level, ref);
      return net && byPhysical.get(net.id);
    },
  };
}
