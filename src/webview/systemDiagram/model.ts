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
  /** Zoom in to a readable size when the node is small (search steps). */
  readable?: true;
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
    (instance.vlnv ?? instance.moduleRef ?? `${instance.component ?? ''} ${instance.version ?? ''}`)
      .toLowerCase()
      .includes(needle)
  );
}

export function boundaryMatchesQuery(pin: SystemPin, query: string): boolean {
  return pin.name.toLowerCase().includes(query.trim().toLowerCase());
}

/** 'xilinx.com:ip:axi_dma:7.1' -> 'axi_dma:7.1'. */
export function shortVlnv(vlnv: string): string {
  return vlnv.split(':').slice(2).join(':') || vlnv;
}

/**
 * Short type text of an ip or module instance (outline row, node header):
 * the short VLNV, the module reference, or qsys `component version`.
 */
export function instanceTypeLabel(instance: SystemInstance): string | undefined {
  if (instance.kind === 'module') {
    return instance.moduleRef;
  }
  if (instance.vlnv) {
    return shortVlnv(instance.vlnv);
  }
  if (instance.component) {
    return instance.version ? `${instance.component} ${instance.version}` : instance.component;
  }
  return undefined;
}

/** Pin fields the hover card reads; instance pin rows and boundary pins both satisfy it. */
export type HoverPin = Pick<
  SystemPin,
  'name' | 'direction' | 'directionSource' | 'definedBy' | 'interfaceType' | 'signalType'
>;

export interface PinHoverTarget {
  pin: HoverPin;
  netNames: readonly string[];
  /** Side the pin sits on; the card opens on the opposite side of the anchor. */
  side: 'west' | 'east';
}

/** Hover card text of a pin: the full name first, then one fact per line. */
export function pinHoverLines(pin: HoverPin, netNames: readonly string[]): string[] {
  const lines = [pin.name, `${pin.direction} · from ${pin.directionSource}`];
  if (pin.interfaceType) {
    lines.push(`interface ${pin.interfaceType}`);
  } else if (pin.signalType) {
    lines.push(`signal ${pin.signalType}`);
  }
  lines.push(...(netNames.length > 0 ? netNames : ['unconnected']));
  if (pin.definedBy) {
    lines.push(`defined by ${pin.definedBy}`);
  }
  return lines;
}

/** Node header subtitle: hierarchy size, type label, or the module marker. */
export function instanceSubtitle(instance: SystemInstance, cells: number): string {
  return instance.kind === 'hier'
    ? `Hierarchy · ${cells} cells`
    : (instanceTypeLabel(instance) ?? (instance.kind === 'module' ? 'module' : ''));
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

/**
 * Every net of `level` touching each endpoint, in graph order, keyed by
 * {@link endpointKey}. A pin can sit on several nets (Platform Designer groups
 * nets by start, so a sink can have more than one driver net).
 */
export function netsByEndpoint(graph: SystemGraph, level: string): Map<string, SystemNet[]> {
  const lookup = new Map<string, SystemNet[]>();
  for (const net of netsOfLevel(graph, level)) {
    for (const ref of net.endpoints) {
      const key = endpointKey(ref);
      const nets = lookup.get(key);
      if (nets) {
        nets.push(net);
      } else {
        lookup.set(key, [net]);
      }
    }
  }
  return lookup;
}

/**
 * The level and selection to show after the graph changed: a vanished level
 * goes back to the root (dropping the selection), and a selection that no
 * longer exists is cleared. Returns the inputs unchanged when still valid.
 */
export function reconcileNavigation(
  graph: SystemGraph,
  levelPath: string,
  selection: Selection | null
): { levelPath: string; selection: Selection | null } {
  if (!graph.levels[levelPath]) {
    return { levelPath: '/', selection: null };
  }
  return {
    levelPath,
    selection: selection && selectionExists(graph, selection) ? selection : null,
  };
}

function selectionExists(graph: SystemGraph, selection: Selection): boolean {
  switch (selection.kind) {
    case 'instance':
      return graph.instances[selection.id] !== undefined;
    case 'boundary': {
      const { level, pin } = parseBoundaryId(selection.id);
      return graph.levels[level]?.boundaryPins.some((candidate) => candidate.name === pin) ?? false;
    }
    case 'net':
      return graph.nets.some((net) => net.id === selection.id);
  }
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

/** True for the two Platform Designer sources (`.qsys` and `qsys-script` Tcl). */
export function isPlatformDesigner(format: SystemGraph['source']['format']): boolean {
  return format === 'qsys' || format === 'qsys-tcl';
}

/** Range cell of the address map: unknown (not tool-assigned) for Platform Designer, `auto` otherwise. */
export function segmentRangeText(
  segment: AddressSegment,
  format: SystemGraph['source']['format']
): string {
  if (segment.range !== undefined) {
    return segment.range;
  }
  return isPlatformDesigner(format) ? '-' : 'auto';
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
