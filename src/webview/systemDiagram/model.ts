/**
 * Pure helpers over a {@link SystemGraph} for the system diagram webview:
 * navigation, pin and net lookups, search matching, and address-map arithmetic.
 */

import type {
  AddressSegment,
  PinRef,
  SystemGraph,
  SystemInstance,
  SystemNet,
  SystemPin,
} from '../../domain/systemGraph';
import { endpointRole, type EndpointRole } from '../../domain/systemGraphRoles';

export type Selection =
  | { kind: 'instance'; id: string }
  | { kind: 'boundary'; id: string }
  | { kind: 'net'; id: string };

/** Ask to centre a node once the diagram of `levelPath` is shown; `token` makes repeats distinct. */
export interface RevealRequest {
  token: number;
  selection: Selection;
  levelPath: string;
}

export interface Breadcrumb {
  path: string;
  label: string;
}

/** Path of the level that contains `instancePath`; '/' for root children. */
export function levelOf(instancePath: string): string {
  const cut = instancePath.lastIndexOf('/');
  return cut <= 0 ? '/' : instancePath.slice(0, cut);
}

/** Root first, then one crumb per hierarchy step down to `levelPath`. */
export function breadcrumbs(levelPath: string, rootName: string): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [{ path: '/', label: rootName }];
  let current = '';
  for (const part of levelPath.split('/').filter(Boolean)) {
    current = `${current}/${part}`;
    crumbs.push({ path: current, label: part });
  }
  return crumbs;
}

export function boundaryId(levelPath: string, pinName: string): string {
  return `${levelPath}::${pinName}`;
}

export function parseBoundaryId(id: string): { level: string; pin: string } {
  const cut = id.lastIndexOf('::');
  return { level: id.slice(0, cut), pin: id.slice(cut + 2) };
}

export function pinRole(pin: SystemPin, isBoundary: boolean): EndpointRole {
  return endpointRole(pin.direction, isBoundary);
}

export function resolvePin(graph: SystemGraph, level: string, ref: PinRef): SystemPin | undefined {
  const pins =
    ref.instance === null ? graph.levels[level]?.boundaryPins : graph.instances[ref.instance]?.pins;
  return pins?.find((pin) => pin.name === ref.pin);
}

/** First source endpoint of the net, else its first endpoint. */
export function netDriver(graph: SystemGraph, net: SystemNet): PinRef | undefined {
  const source = net.endpoints.find((ref) => {
    const pin = resolvePin(graph, net.level, ref);
    return pin !== undefined && pinRole(pin, ref.instance === null) === 'source';
  });
  return source ?? net.endpoints[0];
}

export function isClockOrReset(net: SystemNet): boolean {
  return net.category === 'clock' || net.category === 'reset';
}

export function matchesQuery(instance: SystemInstance, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return true;
  }
  return (
    instance.name.toLowerCase().includes(needle) ||
    (instance.vlnv ?? instance.moduleRef ?? '').toLowerCase().includes(needle)
  );
}

export function boundaryMatchesQuery(pin: SystemPin, query: string): boolean {
  return pin.name.toLowerCase().includes(query.trim().toLowerCase());
}

/** 'xilinx.com:ip:axi_dma:7.1' -> 'axi_dma:7.1'. */
export function shortVlnv(vlnv: string): string {
  return vlnv.split(':').slice(2).join(':') || vlnv;
}

export function netsOfLevel(graph: SystemGraph, level: string): SystemNet[] {
  return graph.nets.filter((net) => net.level === level);
}

export function visibleNets(
  graph: SystemGraph,
  level: string,
  showClockReset: boolean
): SystemNet[] {
  return netsOfLevel(graph, level).filter((net) => showClockReset || !isClockOrReset(net));
}

/** Key identifying an endpoint within a level, for pin -> net lookups. */
export function endpointKey(ref: PinRef): string {
  return `${ref.instance ?? ''}::${ref.pin}`;
}

/** The first net of `level` touching each endpoint, keyed by {@link endpointKey}. */
export function netByEndpoint(graph: SystemGraph, level: string): Map<string, SystemNet> {
  const lookup = new Map<string, SystemNet>();
  for (const net of netsOfLevel(graph, level)) {
    for (const ref of net.endpoints) {
      const key = endpointKey(ref);
      if (!lookup.has(key)) {
        lookup.set(key, net);
      }
    }
  }
  return lookup;
}

/** Level that must be shown for `selection` to be visible. */
export function selectionLevel(graph: SystemGraph, selection: Selection): string | undefined {
  switch (selection.kind) {
    case 'instance':
      return graph.instances[selection.id]?.parent;
    case 'boundary':
      return parseBoundaryId(selection.id).level;
    case 'net':
      return graph.nets.find((net) => net.id === selection.id)?.level;
  }
}

/** Number of cells directly inside a level. */
export function cellCount(graph: SystemGraph, levelPath: string): number {
  return graph.levels[levelPath]?.instances.length ?? 0;
}

const HEX = /^0x[0-9a-f]+$/i;

/** Last address of a segment as '0x...' when offset and range are both hex; else undefined. */
export function segmentHigh(segment: AddressSegment): string | undefined {
  if (!segment.offset || !segment.range || !HEX.test(segment.offset) || !HEX.test(segment.range)) {
    return undefined;
  }
  const range = BigInt(segment.range);
  if (range === BigInt(0)) {
    return undefined;
  }
  const high = BigInt(segment.offset) + range - BigInt(1);
  const digits = Math.max(segment.offset.length - 2, 8);
  return `0x${high.toString(16).toUpperCase().padStart(digits, '0')}`;
}
