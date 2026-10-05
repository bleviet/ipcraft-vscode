import { applyPathEdits, applyPathDeletes } from '../../yamledit';
import type { BusInterface } from '../../domain/ipcore.types';
import { canonicalizeBusType } from './canonicalize';
import { canonicalizeBusInterfacePorts } from './polarity';
import type { BusInterfacePortMutation, NormalizedBusLibrary } from './types';

export function canonicalizeParsedIpCore(
  data: Record<string, unknown>,
  library: NormalizedBusLibrary | undefined
): {
  ipCore: Record<string, unknown>;
  mutations: readonly BusInterfacePortMutation[];
} {
  if (!library || !Array.isArray(data.busInterfaces)) {
    return { ipCore: data, mutations: [] };
  }

  const parsedBusInterfaces = data.busInterfaces as unknown[];
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
    mutations.push(...canonicalized.mutations);
    return canonicalized.busInterface;
  });

  return {
    ipCore: { ...data, busInterfaces },
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
