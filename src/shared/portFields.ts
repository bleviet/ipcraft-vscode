import type { BusInterface, IpCore, Parameter, PortFieldDef } from '../domain/ipcore.types';
import { parseBitsRange } from './bitRange';
import {
  createParameterContext,
  isPortActive,
  resolveBusInterface,
  resolveNumericValue,
  type NormalizedBusLibrary,
} from './busContracts';

export interface PortFieldBitRange {
  msb: number;
  lsb: number;
}

/** Where a field list lives in an IP core, with the facts both consumers need. */
export interface PortFieldList {
  kind: 'port' | 'conduit' | 'bus';
  /** Top-level or conduit port name, or the authored `portFields` key for a bus port. */
  portName: string;
  /** Bus interface that owns a conduit or bus port. */
  busInterface?: string;
  /** Path of the field array; a field index is appended per issue. */
  path: readonly (string | number)[];
  fields: readonly PortFieldDef[];
  /** Resolved port width, or undefined when it does not resolve. */
  width: number | undefined;
  /** Bus keys only: the contract's (or raw port map's) casing when the key names a port. */
  canonicalPortName?: string;
  /** Bus keys only: why the key is not a usable port of the interface. */
  keyProblem?: 'unknown' | 'inactive';
  /** Bus keys only: the matched contract key, used in the unknown-port message. */
  contractKey?: string;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** The field's bit range, or a reason string when its position is malformed. */
export function portFieldRange(field: PortFieldDef): PortFieldBitRange | string {
  const hasBits = field.bits !== undefined && field.bits !== null;
  const hasOffset = field.offset !== undefined && field.offset !== null;
  const hasWidth = field.width !== undefined && field.width !== null;
  if (hasBits && (hasOffset || hasWidth)) {
    return 'use bits or offset/width, not both';
  }
  if (hasBits) {
    const parsed = parseBitsRange(String(field.bits));
    if (!parsed) {
      return `bits '${String(field.bits)}' is not a valid range`;
    }
    return { msb: Math.max(...parsed), lsb: Math.min(...parsed) };
  }
  if (hasOffset && hasWidth) {
    if (!isNonNegativeInteger(field.offset) || !isNonNegativeInteger(field.width) || !field.width) {
      return 'offset must be a non-negative integer and width a positive integer';
    }
    return { msb: field.offset + field.width - 1, lsb: field.offset };
  }
  return 'use bits or offset/width';
}

function busFieldLists(
  bus: BusInterface,
  busIndex: number,
  parameters: readonly Parameter[],
  library: NormalizedBusLibrary
): PortFieldList[] {
  const entries = Object.entries(bus.portFields ?? {});
  if (entries.length === 0) {
    return [];
  }
  const resolution = resolveBusInterface({
    busInterface: bus,
    busIndex,
    parameters,
    library,
  });
  const contract = resolution.match?.contract;
  const rawPortMaps = (bus as { rawPortMaps?: Array<{ logical: string; width: number }> })
    .rawPortMaps;
  const canKeyCheck = contract !== undefined || (rawPortMaps?.length ?? 0) > 0;

  return entries.map(([key, fields]): PortFieldList => {
    const lower = key.toLowerCase();
    const list: PortFieldList = {
      kind: 'bus',
      portName: key,
      busInterface: bus.name,
      path: ['busInterfaces', busIndex, 'portFields', key],
      fields,
      width: undefined,
    };
    if (contract) {
      list.contractKey = contract.key;
      const port = contract.ports.find((candidate) => candidate.name.toLowerCase() === lower);
      if (!port) {
        list.keyProblem = 'unknown';
      } else {
        list.canonicalPortName = port.name;
        list.width = resolution.portWidths[port.name]?.value;
        if (!isPortActive(port, resolution.canonicalBusInterface!)) {
          list.keyProblem = 'inactive';
        }
      }
    } else if (canKeyCheck) {
      const raw = rawPortMaps?.find((map) => map.logical.toLowerCase() === lower);
      if (!raw) {
        list.keyProblem = 'unknown';
      } else {
        list.canonicalPortName = raw.logical;
        list.width = raw.width;
      }
    }
    return list;
  });
}

/**
 * Every non-empty port field list of an IP core, in file order: top-level
 * ports, then per bus interface its conduit ports and `portFields` keys.
 * Bus keys are only enumerated when a bus library is available.
 */
export function enumeratePortFieldLists(
  ipCore: IpCore,
  library: NormalizedBusLibrary | undefined
): PortFieldList[] {
  const parameters = (ipCore.parameters ?? []) as readonly Parameter[];
  const context = createParameterContext(parameters);
  const resolveWidth = (raw: unknown): number | undefined =>
    resolveNumericValue(raw ?? 1, context).value;
  const lists: PortFieldList[] = [];

  (ipCore.ports ?? []).forEach((port, i) => {
    if (port.fields?.length) {
      lists.push({
        kind: 'port',
        portName: port.name,
        path: ['ports', i, 'fields'],
        fields: port.fields,
        width: resolveWidth(port.width),
      });
    }
  });

  (ipCore.busInterfaces ?? []).forEach((bus, b) => {
    const conduitPorts = Array.isArray(bus.conduitPorts) ? bus.conduitPorts : [];
    conduitPorts.forEach((port, c) => {
      if (port.fields?.length) {
        lists.push({
          kind: 'conduit',
          portName: port.name,
          busInterface: bus.name,
          path: ['busInterfaces', b, 'conduitPorts', c, 'fields'],
          fields: port.fields,
          width: resolveWidth(port.width),
        });
      }
    });
    if (library) {
      lists.push(...busFieldLists(bus, b, parameters, library));
    }
  });
  return lists;
}
