/**
 * Physical nets: the nets of every hierarchy level joined into the single wires
 * they really are. A hierarchy instance pin on the parent level is the same wire
 * as the boundary pin of the level inside, so the nets on both sides of it are
 * one physical net. Everything is keyed by graph identity (level, instance path,
 * pin name), never by what the diagram draws.
 */

import type { PinRef, SystemGraph, SystemNet } from '../../../domain/systemGraph';
import { endpointKey, netDriver } from '../model';
import { UnionFind } from './unionFind';

/** A pin as seen on one level; `instance` is null for a boundary pin of `level`. */
export interface PinEnd {
  level: string;
  instance: string | null;
  pin: string;
}

/** Key of a pin as seen on `level`; the same pin on another level has another key. */
export function occurrenceKey(level: string, ref: PinRef): string {
  return `${level}|${endpointKey(ref)}`;
}

export function endKey(end: PinEnd): string {
  return occurrenceKey(end.level, { instance: end.instance, pin: end.pin });
}

export interface PhysicalNet {
  /** `p0`, `p1`, ...: in the script order of the nets that hold the drivers. */
  id: string;
  /** Member nets, in graph order. */
  nets: SystemNet[];
  /** Leaf instance pins and root external ports; hierarchy pins are pass-through, never ends. */
  ends: PinEnd[];
  /** First end that drives one of the member nets (Vivado lists the driver first). */
  driver?: PinEnd;
  /** The member net that holds the driver. */
  driverNet?: SystemNet;
}

export interface PhysicalNets {
  nets: readonly PhysicalNet[];
  ofNet: (netId: string) => PhysicalNet | undefined;
  /** The physical net a pin occurrence sits on (the first one, for a pin on several nets). */
  ofPin: (level: string, ref: PinRef) => PhysicalNet | undefined;
}

/** The pin occurrence on the other side of a hierarchy pin, if `ref` is one. */
function otherSide(graph: SystemGraph, level: string, ref: PinRef): string | undefined {
  if (ref.instance !== null) {
    return graph.instances[ref.instance]?.kind === 'hier'
      ? occurrenceKey(ref.instance, { instance: null, pin: ref.pin })
      : undefined;
  }
  const hierarchy = graph.instances[level];
  return hierarchy?.kind === 'hier'
    ? occurrenceKey(hierarchy.parent, { instance: level, pin: ref.pin })
    : undefined;
}

function isEnd(graph: SystemGraph, level: string, ref: PinRef): boolean {
  if (ref.instance === null) {
    return level === '/';
  }
  const kind = graph.instances[ref.instance]?.kind;
  return kind === 'ip' || kind === 'module';
}

export function buildPhysicalNets(graph: SystemGraph): PhysicalNets {
  const touching = new Map<string, number[]>();
  graph.nets.forEach((net, index) => {
    for (const ref of net.endpoints) {
      const key = occurrenceKey(net.level, ref);
      touching.set(key, [...(touching.get(key) ?? []), index]);
    }
  });
  const sets = new UnionFind(graph.nets.length);
  graph.nets.forEach((net, index) => {
    for (const ref of net.endpoints) {
      const other = otherSide(graph, net.level, ref);
      const joined = other === undefined ? [] : (touching.get(other) ?? []);
      for (const neighbour of joined) {
        sets.union(index, neighbour);
      }
    }
  });

  const members = new Map<number, SystemNet[]>();
  graph.nets.forEach((net, index) => {
    const root = sets.find(index);
    const group = members.get(root);
    if (group) {
      group.push(net);
    } else {
      members.set(root, [net]);
    }
  });
  const netIndex = new Map(graph.nets.map((net, index) => [net.id, index]));
  const unsorted = [...members.values()].map((nets) => {
    const ends = new Map<string, PinEnd>();
    for (const net of nets) {
      for (const ref of net.endpoints) {
        if (isEnd(graph, net.level, ref)) {
          ends.set(occurrenceKey(net.level, ref), {
            level: net.level,
            instance: ref.instance,
            pin: ref.pin,
          });
        }
      }
    }
    let driver: PinEnd | undefined;
    let driverNet: SystemNet | undefined;
    for (const net of nets) {
      const ref = netDriver(graph, net);
      if (ref && isEnd(graph, net.level, ref)) {
        driver = { level: net.level, instance: ref.instance, pin: ref.pin };
        driverNet = net;
        break;
      }
    }
    return { nets, ends: [...ends.values()], driver, driverNet };
  });
  const order = (net: SystemNet | undefined, fallback: SystemNet) =>
    netIndex.get((net ?? fallback).id) ?? 0;
  const physical: PhysicalNet[] = unsorted
    .sort((a, b) => order(a.driverNet, a.nets[0]) - order(b.driverNet, b.nets[0]))
    .map((entry, index) => ({ id: `p${index}`, ...entry }));

  const byNet = new Map<string, PhysicalNet>();
  for (const net of physical) {
    for (const member of net.nets) {
      byNet.set(member.id, net);
    }
  }
  return {
    nets: physical,
    ofNet: (netId) => byNet.get(netId),
    ofPin: (level, ref) => {
      // A hierarchy pin with no net on this side sits on the net of its other side.
      const other = otherSide(graph, level, ref);
      const first = (touching.get(occurrenceKey(level, ref)) ??
        (other === undefined ? undefined : touching.get(other)))?.[0];
      return first === undefined ? undefined : byNet.get(graph.nets[first].id);
    },
  };
}
