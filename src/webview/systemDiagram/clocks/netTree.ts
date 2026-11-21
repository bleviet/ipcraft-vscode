/**
 * The tree of a clock, reset, or data/bus connection net as rows with a depth:
 * the source, then per net its loads, descending into hierarchy blocks,
 * following the net out of a hierarchy through its boundary pins and through
 * clock-forwarding blocks. Every net is listed once.
 */

import type { PinRef, SystemGraph, SystemNet } from '../../../domain/systemGraph';
import { openNetsByEndpoint } from '../layout/unionGraph';
import { boundaryId, endpointKey, netsByEndpoint } from '../model';
import { passThroughOf } from './clockRules';

export type TreePinRole = 'source' | 'load' | 'enter' | 'exit' | 'forward' | 'port';

/** A net of the tree, on its level. */
export interface TreeNetRow {
  kind: 'net';
  depth: number;
  net: SystemNet;
  /** Name of the net's level: the design name, or the hierarchy block's name. */
  levelName: string;
}

/**
 * A pin on the way. `enter`: a hierarchy pin the net goes into; `exit`: a
 * boundary pin of a hierarchy through which it leaves; `forward`: the output of
 * a clock-forwarding block; `port`: a root external port.
 */
export interface TreePinRow {
  kind: 'pin';
  role: TreePinRole;
  depth: number;
  /** Level the pin is seen on. */
  level: string;
  ref: PinRef;
  /** `instanceName/pin`, or the port name. */
  label: string;
  /** Diagram node to select: the instance path, or the boundary id of a port. */
  nodeId: string;
}

export type TreeRow = TreeNetRow | TreePinRow;

export function levelName(graph: SystemGraph, level: string): string {
  return level === '/' ? graph.name : (graph.levels[level]?.name ?? level);
}

function sameRef(a: PinRef, b: PinRef): boolean {
  return a.instance === b.instance && a.pin === b.pin;
}

/**
 * Whether `row` is where the tree crosses boundary pin `pin` of hierarchy `level`:
 * the `enter` row seen on the parent level, or the `exit` row seen on the level itself.
 */
export function isBoundaryPinRow(row: TreePinRow, level: string, pin: string): boolean {
  return (
    row.ref.pin === pin &&
    (row.ref.instance === level || (row.ref.instance === null && row.level === level))
  );
}

/** The pin row of `ref` as seen on `level`. */
export function pinRow(
  graph: SystemGraph,
  role: TreePinRole,
  depth: number,
  level: string,
  ref: PinRef
): TreePinRow {
  const instance = ref.instance === null ? undefined : graph.instances[ref.instance];
  return {
    kind: 'pin',
    role,
    depth,
    level,
    ref,
    label: instance ? `${instance.name}/${ref.pin}` : ref.pin,
    nodeId: ref.instance ?? boundaryId(level, ref.pin),
  };
}

/**
 * Rows of the tree that starts at net `netId`, whose pin `source` is the driver
 * (absent when the source is not known: every pin of the net is listed).
 * The net rows start at depth 1; the caller draws the source above them.
 * Nets in `ghostNets` (what only the base of a comparison has) are not walked.
 */
export function netTreeRows(
  graph: SystemGraph,
  netId: string,
  source?: PinRef,
  ghostNets?: ReadonlySet<string>
): TreeRow[] {
  const nets = new Map<string, ReadonlyMap<string, SystemNet[]>>();
  const netsAt = (level: string, ref: PinRef): SystemNet[] => {
    let lookup = nets.get(level);
    if (!lookup) {
      lookup = ghostNets
        ? openNetsByEndpoint(graph, level, ghostNets)
        : netsByEndpoint(graph, level);
      nets.set(level, lookup);
    }
    return lookup.get(endpointKey(ref)) ?? [];
  };
  const rows: TreeRow[] = [];
  const visited = new Set<string>();

  const walk = (net: SystemNet, entry: PinRef | undefined, depth: number): void => {
    if (visited.has(net.id)) {
      return;
    }
    visited.add(net.id);
    rows.push({ kind: 'net', depth, net, levelName: levelName(graph, net.level) });
    for (const ref of net.endpoints) {
      if (entry && sameRef(ref, entry)) {
        continue;
      }
      if (ref.instance === null) {
        if (net.level === '/') {
          rows.push(pinRow(graph, 'port', depth, net.level, ref));
        } else {
          rows.push(pinRow(graph, 'exit', depth, net.level, ref));
          const outer = { instance: net.level, pin: ref.pin };
          const parent = graph.instances[net.level]?.parent ?? '/';
          netsAt(parent, outer).forEach((next) => walk(next, outer, depth + 1));
        }
        continue;
      }
      const instance = graph.instances[ref.instance];
      if (!instance) {
        continue;
      }
      if (instance.kind === 'hier') {
        rows.push(pinRow(graph, 'enter', depth, net.level, ref));
        const inner = { instance: null, pin: ref.pin };
        netsAt(instance.path, inner).forEach((next) => walk(next, inner, depth + 1));
        continue;
      }
      rows.push(pinRow(graph, 'load', depth, net.level, ref));
      const forwarding = passThroughOf(instance);
      if (forwarding?.input === ref.pin) {
        const output = { instance: instance.path, pin: forwarding.output };
        netsAt(instance.parent, output).forEach((next) => walk(next, output, depth + 1));
      }
    }
  };

  const start = graph.nets.find((net) => net.id === netId);
  if (start) {
    walk(start, source, 1);
  }
  return rows;
}
