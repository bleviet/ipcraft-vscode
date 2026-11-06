/**
 * Clock domain crossings (CDC) of data connections, reset domain crossings
 * (RDC) of reset sinks, and blocks whose clocks span several domains. Every
 * record keeps both ends, the nets it touches and a one-sentence reason. The
 * status is "unchecked" whenever a clock is not known; Platform Designer
 * inserts clock-crossing adapters and reset synchronizers itself, so a
 * crossing there is "ok".
 */

import type { NetCategory, SystemGraph, SystemNet } from '../../../domain/systemGraph';
import { boundaryId, isPlatformDesigner } from '../model';
import { isAsyncResetSink } from './clockRules';
import { levelDepth } from './levelPaths';
import type { ClockDomains } from './clockDomains';
import type {
  BlockCrossing,
  Crossing,
  CrossingEnd,
  CrossingKind,
  CrossingStatus,
  PinCrossing,
} from './clockTypes';
import type { PinClocks } from './pinClocks';
import { endKey, type PhysicalNet, type PhysicalNets, type PinEnd } from './physicalNets';
import type { ResetSources } from './resetSources';

/** Net categories of the data connections that are checked for clock domain crossings. */
export const DATA_CATEGORIES: readonly NetCategory[] = ['aximm', 'axis', 'avalonmm', 'avalonst'];
const STATUS_ORDER: Record<CrossingStatus, number> = { cross: 0, inside: 1, unchecked: 2, ok: 3 };
const KIND_ORDER: Record<CrossingKind, number> = { data: 0, reset: 1, block: 2 };
const HANDLED = 'Handled by Platform Designer';

interface Verdict {
  status: CrossingStatus;
  reason: string;
}

interface Context {
  graph: SystemGraph;
  physical: PhysicalNets;
  model: ClockDomains;
  pinClocks: PinClocks;
  sources: ResetSources;
}

/** The member net of `net` on `end`'s level that holds `end`. */
function netOf(net: PhysicalNet, end: PinEnd): SystemNet {
  return (
    net.nets.find(
      (member) =>
        member.level === end.level &&
        member.endpoints.some((ref) => ref.instance === end.instance && ref.pin === end.pin)
    ) ??
    net.driverNet ??
    net.nets[0]
  );
}

function crossingEnd(
  { graph }: Context,
  end: PinEnd,
  extra: Partial<CrossingEnd> = {}
): CrossingEnd {
  const instance = end.instance === null ? undefined : graph.instances[end.instance];
  return {
    ...end,
    label: instance ? `${instance.name}/${end.pin}` : end.pin,
    nodeId: end.instance ?? boundaryId(end.level, end.pin),
    ...extra,
  };
}

/** An end whose domain is that of its pin's clock. */
function clockedEnd(ctx: Context, end: PinEnd): CrossingEnd {
  const clock = ctx.pinClocks.clockOfPin(end.level, { instance: end.instance, pin: end.pin });
  return crossingEnd(ctx, end, {
    ...(clock?.clockPin !== undefined && { clockPin: clock.clockPin }),
    ...(clock?.domain && { domain: clock.domain }),
    ...(clock && { knownFrom: clock.knownFrom }),
  });
}

function unknownClocks(ctx: Context, ends: readonly CrossingEnd[]): string {
  return ends
    .filter((end) => !end.domain)
    .map((end) => ctx.pinClocks.unknownReason(end.level, { instance: end.instance, pin: end.pin }))
    .join('. ');
}

function crossesDomains(ctx: Context, reason: string): Verdict {
  return isPlatformDesigner(ctx.graph.source.format)
    ? { status: 'ok', reason: HANDLED }
    : { status: 'cross', reason };
}

function dataVerdict(ctx: Context, from: CrossingEnd, to: CrossingEnd): Verdict {
  if (!from.domain || !to.domain) {
    return { status: 'unchecked', reason: unknownClocks(ctx, [from, to]) };
  }
  if (from.domain === to.domain) {
    return { status: 'ok', reason: `Both ends on ${from.domain.name}` };
  }
  return crossesDomains(
    ctx,
    `${from.label} is on ${from.domain.name} and ${to.label} on ${to.domain.name}; no synchronizer is known between them`
  );
}

function dataCrossings(ctx: Context): PinCrossing[] {
  const found: PinCrossing[] = [];
  for (const net of ctx.physical.nets) {
    const category = net.nets
      .map((member) => member.category)
      .find((c) => DATA_CATEGORIES.includes(c));
    const { driver } = net;
    if (!category || !driver) {
      continue;
    }
    const from = clockedEnd(ctx, driver);
    // The shallowest member net, as the diagram of the top level shows it. The driver's own net
    // wins a tie: `net.nets` is in graph order and inner nets come first.
    const open = net.nets.reduce(
      (best, member) => (levelDepth(member.level) < levelDepth(best.level) ? member : best),
      netOf(net, driver)
    );
    for (const load of net.ends.filter((end) => endKey(end) !== endKey(driver))) {
      const to = clockedEnd(ctx, load);
      found.push({
        id: `data:${endKey(driver)}>${endKey(load)}`,
        kind: 'data',
        ...dataVerdict(ctx, from, to),
        level: open.level,
        netIds: net.nets.map((member) => member.id),
        from,
        to,
        netId: open.id,
        category,
      });
    }
  }
  return found;
}

function resetVerdict(ctx: Context, source: CrossingEnd, sink: CrossingEnd): Verdict {
  const { graph } = ctx;
  const sinkInstance = sink.instance === null ? undefined : graph.instances[sink.instance];
  if (sinkInstance && isAsyncResetSink(sinkInstance, sink.pin)) {
    return { status: 'ok', reason: 'The input accepts an asynchronous reset' };
  }
  if (!sink.domain) {
    return { status: 'unchecked', reason: unknownClocks(ctx, [sink]) };
  }
  if (!source.async && !source.domain) {
    // Platform Designer adds a reset synchronizer per sink clock domain, whatever releases the source.
    return isPlatformDesigner(graph.source.format)
      ? { status: 'ok', reason: HANDLED }
      : {
          status: 'unchecked',
          reason: `No rule says which clock ${source.label} is synchronized to`,
        };
  }
  if (source.async || source.domain !== sink.domain) {
    const released = source.async ? 'asynchronous' : `released on ${source.domain?.name}`;
    return crossesDomains(
      ctx,
      `${sink.label} is clocked by ${sink.domain.name} but its reset ${source.label} is ${released}`
    );
  }
  return { status: 'ok', reason: `Released on ${sink.domain.name}` };
}

function resetCrossings(ctx: Context): PinCrossing[] {
  const found: PinCrossing[] = [];
  for (const [reset, net] of ctx.sources.trees) {
    const from = crossingEnd(ctx, reset.source, {
      async: reset.async,
      ...(reset.domain && { domain: reset.domain }),
      ...(reset.from !== undefined && { knownFrom: reset.from }),
    });
    for (const sink of reset.sinks) {
      const instance = sink.instance === null ? undefined : ctx.graph.instances[sink.instance];
      const asyncSink = instance !== undefined && isAsyncResetSink(instance, sink.pin);
      const to = asyncSink
        ? crossingEnd(ctx, sink, { async: true, knownFrom: 'asynchronous input' })
        : clockedEnd(ctx, sink);
      found.push({
        id: `reset:${endKey(reset.source)}>${endKey(sink)}`,
        kind: 'reset',
        ...resetVerdict(ctx, from, to),
        level: sink.level,
        netIds: reset.netIds,
        from,
        to,
        netId: netOf(net, sink).id,
      });
    }
  }
  return found;
}

function blockCrossings({ graph, model }: Context): BlockCrossing[] {
  const found: BlockCrossing[] = [];
  for (const instance of Object.values(graph.instances)) {
    const domains = instance.kind === 'hier' ? [] : model.instanceDomains(instance.path);
    if (domains.length >= 2) {
      found.push({
        id: `block:${instance.path}`,
        kind: 'block',
        status: 'inside',
        level: instance.parent,
        netIds: [],
        reason: `${instance.name} has clocks on ${domains.map((domain) => domain.name).join(', ')}; review that it synchronizes`,
        instance: instance.path,
        domains,
      });
    }
  }
  return found;
}

/** All crossings: `cross` first, then `inside`, `unchecked`, `ok`; data before reset within a status. */
export function buildCrossings(
  graph: SystemGraph,
  physical: PhysicalNets,
  model: ClockDomains,
  pinClocks: PinClocks,
  sources: ResetSources
): Crossing[] {
  const ctx: Context = { graph, physical, model, pinClocks, sources };
  return [...dataCrossings(ctx), ...resetCrossings(ctx), ...blockCrossings(ctx)].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
  );
}
