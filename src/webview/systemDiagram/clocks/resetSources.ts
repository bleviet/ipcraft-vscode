/**
 * Reset sources: every reset physical net with a driver is one. A rule says
 * which clock releases the driver (or that it is asynchronous); an external reset
 * port is released on the clock port that lists it in `CONFIG.ASSOCIATED_RESET`.
 * No rule means unknown: neither asynchronous nor tied to a domain.
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
    if (!driver || !driverNet || !net.nets.some((member) => member.category === 'reset')) {
      continue;
    }
    const instance = driver.instance === null ? undefined : graph.instances[driver.instance];
    let async = false;
    let domain: ClockDomain | undefined;
    let from: string | undefined;
    if (instance) {
      const release = resetRelease(instance, driver.pin);
      async = release?.async ?? false;
      from = release?.from;
      if (release?.clockPin !== undefined) {
        domain = model.domainOfPin(driver.level, {
          instance: instance.path,
          pin: release.clockPin,
        });
      }
    } else {
      const clock = pinClocks.clockOfPin(driver.level, { instance: null, pin: driver.pin });
      domain = clock?.domain;
      from = clock?.knownFrom;
    }
    const index = resets.length;
    const source: ResetSource = {
      id: `reset:${index}`,
      index,
      label: instance ? `${instance.name}/${driver.pin}` : driver.pin,
      source: driver,
      netId: driverNet.id,
      async,
      ...(domain && { domain }),
      ...(from !== undefined && { from }),
      line: driverNet.line,
      netIds: net.nets.map((member) => member.id),
      sinks: net.ends.filter((end) => endKey(end) !== endKey(driver)),
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
