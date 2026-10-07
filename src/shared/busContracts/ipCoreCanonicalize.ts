import { applyPathEdits, applyPathDeletes } from '../../yamledit';
import type { BusInterface } from '../../domain/ipcore.types';
import { canonicalizeBusType, canonicalizeDottedBusType } from './canonicalize';
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

    let busInterface = rawBus as BusInterface;
    const type = String(busInterface.type ?? '');
    let match = canonicalizeBusType(type, library);
    if (!match) {
      match = canonicalizeDottedBusType(type, library);
      if (!match) {
        return rawBus;
      }
      busInterface = { ...busInterface, type: match.canonicalVlnv };
      mutations.push([['busInterfaces', index, 'type'], match.canonicalVlnv]);
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

/** Type rewrites for bus interfaces spelled with a dotted VLNV that resolves to a contract. */
export function dottedBusTypeMutations(
  data: Record<string, unknown>,
  library: NormalizedBusLibrary
): BusInterfacePortMutation[] {
  if (!Array.isArray(data.busInterfaces)) {
    return [];
  }
  const mutations: BusInterfacePortMutation[] = [];
  (data.busInterfaces as unknown[]).forEach((rawBus, index) => {
    if (!rawBus || typeof rawBus !== 'object' || Array.isArray(rawBus)) {
      return;
    }
    const type = (rawBus as BusInterface).type;
    if (canonicalizeBusType(type, library)) {
      return;
    }
    const match = canonicalizeDottedBusType(type, library);
    if (match) {
      mutations.push([['busInterfaces', index, 'type'], match.canonicalVlnv]);
    }
  });
  return mutations;
}

export function applyYamlMutation(
  text: string,
  [path, value]: readonly [readonly (string | number)[], unknown]
): string {
  return value === undefined
    ? applyPathDeletes(text, [[...path]])
    : applyPathEdits(text, [{ path: [...path], value }]);
}
