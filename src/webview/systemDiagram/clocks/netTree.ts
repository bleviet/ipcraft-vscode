/**
 * The tree of a clock or reset net as rows with a depth: the source, then per
 * net its loads, descending into hierarchy blocks, following the net out of a
 * hierarchy through its boundary pins and through clock-forwarding blocks.
 * Every net is listed once.
 */

import type { PinRef, SystemGraph, SystemNet } from '../../../domain/systemGraph';
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

function levelName(graph: SystemGraph, level: string): string {
  return level === '/' ? graph.name : (graph.levels[level]?.name ?? level);
}

function sameRef(a: PinRef, b: PinRef): boolean {
  return a.instance === b.instance && a.pin === b.pin;
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
 */
export function netTreeRows(graph: SystemGraph, netId: string, source?: PinRef): TreeRow[] {
  const nets = new Map<string, ReadonlyMap<string, SystemNet[]>>();
  const netsAt = (level: string, ref: PinRef): SystemNet[] => {
    let lookup = nets.get(level);
    if (!lookup) {
      lookup = netsByEndpoint(graph, level);
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
