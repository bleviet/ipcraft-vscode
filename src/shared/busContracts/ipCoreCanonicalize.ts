import * as yaml from 'yaml';
import { applyPathEdits, applyPathDeletes } from '../../yamledit';
import type { BusInterface } from '../../domain/ipcore.types';
import { canonicalizeBusType } from './canonicalize';
import { canonicalizeBusInterfacePorts } from './polarity';
import type { BusInterfacePortMutation, NormalizedBusLibrary } from './types';

/**
 * The schema documents `bus_interfaces` as a snake_case alias for `busInterfaces`
 * (ip_core.schema.json). Unlike the Memory Map domain layer, the IP Core webview
 * reads the parsed YAML object directly without going through domain/parse.ts, so
 * that alias must be resolved here or bus interfaces silently vanish from the canvas.
 */
export function aliasBusInterfaces(data: Record<string, unknown>): Record<string, unknown> {
  if (data.busInterfaces === undefined && Array.isArray(data.bus_interfaces)) {
    return { ...data, busInterfaces: data.bus_interfaces };
  }
  return data;
}

export type BusInterfaceRoot = 'busInterfaces' | 'bus_interfaces';

export function getBusInterfaceRoot(data: Record<string, unknown>): BusInterfaceRoot {
  return data.busInterfaces === undefined && Array.isArray(data.bus_interfaces)
    ? 'bus_interfaces'
    : 'busInterfaces';
}

export function getAuthoredBusInterfaceRoot(text: string): BusInterfaceRoot {
  const parsed = yaml.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'busInterfaces';
  }
  return getBusInterfaceRoot(parsed as Record<string, unknown>);
}

export function remapBusInterfacePath(
  path: readonly (string | number)[],
  root: BusInterfaceRoot
): Array<string | number> {
  return path[0] === 'busInterfaces' ? [root, ...path.slice(1)] : [...path];
}

export function canonicalizeParsedIpCore(
  data: Record<string, unknown>,
  library: NormalizedBusLibrary | undefined
): {
  ipCore: Record<string, unknown>;
  mutations: readonly BusInterfacePortMutation[];
} {
  const busInterfaceRoot = getBusInterfaceRoot(data);
  const aliased = aliasBusInterfaces(data);
  if (!library || !Array.isArray(aliased.busInterfaces)) {
    return { ipCore: aliased, mutations: [] };
  }

  const parsedBusInterfaces = aliased.busInterfaces as unknown[];
  const mutations: BusInterfacePortMutation[] = [];
  const busInterfaces = parsedBusInterfaces.map((rawBus, index) => {
    if (!rawBus || typeof rawBus !== 'object' || Array.isArray(rawBus)) {
      return rawBus;
    }

    const busInterface = rawBus as BusInterface;
    const match = canonicalizeBusType(String(busInterface.type ?? ''), library);
    if (!match) {
      return rawBus;
    }

    const canonicalized = canonicalizeBusInterfacePorts(match.contract, busInterface, index);
    mutations.push(
      ...canonicalized.mutations.map<BusInterfacePortMutation>(([path, value]) => [
        remapBusInterfacePath(path, busInterfaceRoot),
        value,
      ])
    );
    return canonicalized.busInterface;
  });

  return {
    ipCore: { ...aliased, busInterfaces },
    mutations,
  };
}

export function applyYamlMutation(
  text: string,
  [path, value]: readonly [readonly (string | number)[], unknown]
): string {
  return value === undefined
    ? applyPathDeletes(text, [[...path]])
    : applyPathEdits(text, [{ path: [...path], value }]);
}
