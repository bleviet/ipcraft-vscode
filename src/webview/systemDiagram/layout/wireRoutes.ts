/**
 * Pure geometry of the clock and reset wires (issue #283). The blocks of a level
 * stand in columns; the free strips between them are channels. A net crosses the
 * columns through the gaps between blocks, runs one vertical trunk per channel on
 * its own lane, and reaches every terminal by a horizontal tap. The tree is then
 * cut into one polyline per sink. Knows boxes, terminals and polylines only.
 * Lanes keep clear of the vertical data wires and crossings of the horizontal ones
 * (taps cross them). In a channel, a net whose tap comes from the left column
 * takes a lane left of a net whose tap at the same height comes from the right.
 * See docs/concepts/clock-reset-wires.md.
 */

import { cutWires, Tree, type Point, type RoutedWire } from './wireTree';

export type { Point, RoutedWire };

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where a wire meets a pin, and the direction it leaves in. */
export interface Terminal {
  x: number;
  y: number;
  leaves: 'west' | 'east';
}

export interface NetRequest {
  id: string;
  driver: Terminal;
  sinks: { id: string; terminal: Terminal }[];
}

export interface Column {
  left: number;
  right: number;
  /** Sorted by y. */
  boxes: Box[];
}

export const LANE_STEP = 6;
export const CLEARANCE = 4;
export const EDGE_MARGIN = 8;

/** Obstacles whose x-intervals overlap form one column. */
export function columnsOf(obstacles: readonly Box[]): Column[] {
  const sorted = [...obstacles].sort((a, b) => a.x - b.x || a.y - b.y);
  const columns: Column[] = [];
  for (const box of sorted) {
    const last = columns[columns.length - 1];
    if (last && box.x <= last.right) {
      last.right = Math.max(last.right, box.x + box.width);
      last.boxes.push(box);
    } else {
      columns.push({ left: box.x, right: box.x + box.width, boxes: [box] });
    }
  }
  for (const column of columns) {
    column.boxes.sort((a, b) => a.y - b.y);
  }
  return columns;
}

/** The first channel in the direction the terminal leaves. */
export function channelOf(columns: readonly Column[], terminal: Terminal): number {
  return columns.filter((column) =>
    terminal.leaves === 'west' ? column.right <= terminal.x : column.left < terminal.x
  ).length;
}

type Range = readonly [number, number];

/** Free horizontal strips of a column, kept `EDGE_MARGIN` from its boxes; the outer two are open. */
function gapsOf(column: Column): Range[] {
  const gaps: Range[] = [];
  let bottom = -Infinity;
  for (const box of column.boxes) {
    const low = bottom === -Infinity ? -Infinity : bottom + EDGE_MARGIN;
    if (low <= box.y - EDGE_MARGIN) {
      gaps.push([low, box.y - EDGE_MARGIN]);
    }
    bottom = Math.max(bottom, box.y + box.height);
  }
  gaps.push([bottom + EDGE_MARGIN, Infinity]);
  return gaps;
}

/** Index of the first element of the sorted `values` greater than `value`. */
function above(values: readonly number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (values[mid] > value) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

function insertHeight(sorted: number[], value: number): void {
  sorted.splice(above(sorted, value), 0, value);
}

/** Whether a value of the sorted `values` is closer than `distance` to `value`. */
function nearAny(values: readonly number[], value: number, distance: number): boolean {
  const index = above(values, value - distance);
  return index < values.length && values[index] < value + distance;
}

/** Heights held in one column, sorted. Crossings of other nets keep a lane step apart. */
interface Heights {
  /** Horizontal data wires and terminals: `CLEARANCE` apart. */
  fixed: number[];
  /** Crossings assigned so far. */
  placed: number[];
}

/** The position in the gaps of a column closest to `target` that is clear of its held heights. */
function nearestFree(gaps: readonly Range[], target: number, held: Heights): number {
  const free = (y: number) =>
    !nearAny(held.fixed, y, CLEARANCE) && !nearAny(held.placed, y, LANE_STEP);
  let best = NaN;
  let bestDistance = Infinity;
  const search = ([low, high]: Range) => {
    const start = Math.min(Math.max(target, low), high);
    for (let k = 0; ; k++) {
      const down = start - k * LANE_STEP;
      const up = start + k * LANE_STEP;
      if ((down < low && up > high) || Math.abs(start - target) + k * LANE_STEP >= bestDistance) {
        return;
      }
      let found = false;
      for (const y of [down, up]) {
        if (y >= low && y <= high && free(y)) {
          found = true;
          if (Math.abs(y - target) < bestDistance) {
            best = y;
            bestDistance = Math.abs(y - target);
          }
        }
      }
      if (found) {
        return;
      }
    }
  };
  // Gaps by distance from the target: the first gap that ends at or below it, then outwards.
  let right = 0;
  for (let high = gaps.length; right < high; ) {
    const mid = (right + high) >> 1;
    if (gaps[mid][1] >= target) {
      high = mid;
    } else {
      right = mid + 1;
    }
  }
  let left = right - 1;
  while (left >= 0 || right < gaps.length) {
    const toLeft = left >= 0 ? target - gaps[left][1] : Infinity;
    const toRight = right < gaps.length ? Math.max(0, gaps[right][0] - target) : Infinity;
    if (Math.min(toLeft, toRight) >= bestDistance) {
      break;
    }
    search(toLeft <= toRight ? gaps[left--] : gaps[right++]);
  }
  return best;
}

/** What the data wires occupy: vertical x per channel, horizontal y per column, both sorted. */
function dataOccupancy(columns: readonly Column[], wires: readonly (readonly Point[])[]) {
  const verticals: number[][] = [...columns, null].map(() => []);
  const horizontals: number[][] = columns.map(() => []);
  for (const wire of wires) {
    for (let i = 1; i < wire.length; i++) {
      const a = wire[i - 1];
      const b = wire[i];
      if (a.x === b.x && a.y !== b.y) {
        verticals[columns.filter((column) => column.right <= a.x).length].push(a.x);
      } else if (a.y === b.y && a.x !== b.x) {
        const [from, to] = a.x < b.x ? [a.x, b.x] : [b.x, a.x];
        columns.forEach((column, index) => {
          if (from < column.right && to > column.left) {
            horizontals[index].push(a.y);
          }
        });
      }
    }
  }
  const ascending = (a: number, b: number) => a - b;
  verticals.forEach((list) => list.sort(ascending));
  horizontals.forEach((list) => list.sort(ascending));
  return { verticals, horizontals };
}

/** One net and where its terminals sit. */
interface Plan {
  net: NetRequest;
  terminals: Terminal[];
  channels: number[];
  /** Outermost channels with a terminal. */
  lowest: number;
  highest: number;
}

function planOf(net: NetRequest, columns: readonly Column[]): Plan {
  const terminals = [net.driver, ...net.sinks.map((sink) => sink.terminal)];
  const channels = terminals.map((terminal) => channelOf(columns, terminal));
  return {
    net,
    terminals,
    channels,
    lowest: channels.reduce((a, b) => Math.min(a, b)),
    highest: channels.reduce((a, b) => Math.max(a, b)),
  };
}

/**
 * Order of the nets using a channel, left to right: a net whose tap comes from the
 * left column goes left of a net whose tap at the same height comes from the right
 * column (Kahn's sort; ties and cycles in request order).
 */
function laneOrder(users: readonly number[], plans: readonly Plan[], channel: number): number[] {
  const taps: { y: number; east: boolean; net: number }[] = [];
  for (const index of users) {
    plans[index].terminals.forEach((terminal, i) => {
      if (plans[index].channels[i] === channel) {
        taps.push({ y: terminal.y, east: terminal.leaves === 'east', net: index });
      }
    });
  }
  taps.sort((a, b) => a.y - b.y);
  const after = new Map<number, Set<number>>();
  const blockers = new Map<number, number>();
  for (let i = 0; i < taps.length; i++) {
    for (let j = i + 1; j < taps.length && taps[j].y - taps[i].y < CLEARANCE; j++) {
      const [a, b] = [taps[i], taps[j]];
      if (a.east !== b.east && a.net !== b.net) {
        const [first, second] = a.east ? [a.net, b.net] : [b.net, a.net];
        const set = after.get(first) ?? after.set(first, new Set()).get(first)!;
        if (!set.has(second)) {
          set.add(second);
          blockers.set(second, (blockers.get(second) ?? 0) + 1);
        }
      }
    }
  }
  const order: number[] = [];
  const placed = new Set<number>();
  while (order.length < users.length) {
    const next =
      users.find((user) => !placed.has(user) && !blockers.get(user)) ??
      users.find((user) => !placed.has(user))!;
    placed.add(next);
    order.push(next);
    after.get(next)?.forEach((user) => blockers.set(user, (blockers.get(user) ?? 0) - 1));
  }
  return order;
}

/**
 * `count` lane x positions in a channel, left to right. Candidates are `LANE_STEP`
 * apart and `CLEARANCE` from the vertical data wires; when a bounded channel has
 * fewer than `count`, the lanes are spread evenly over it instead.
 */
function lanePositions(
  columns: readonly Column[],
  channel: number,
  verticals: readonly number[],
  count: number
): number[] {
  const clear = (x: number) => !nearAny(verticals, x, CLEARANCE);
  const found: number[] = [];
  if (channel === 0 || channel === columns.length) {
    // Open-ended: leftwards of the first column, rightwards of the last.
    const direction = channel === 0 ? -1 : 1;
    const base = channel === 0 ? columns[0].left : columns[columns.length - 1].right;
    for (let step = 0; found.length < count; step++) {
      const x = base + direction * (EDGE_MARGIN + step * LANE_STEP);
      if (clear(x)) {
        found.push(x);
      }
    }
    return channel === 0 ? found.reverse() : found;
  }
  const left = columns[channel - 1].right;
  const right = columns[channel].left;
  for (let x = left + EDGE_MARGIN; x <= right - EDGE_MARGIN; x += LANE_STEP) {
    if (clear(x) && found.length < count) {
      found.push(x);
    }
  }
  if (found.length >= count) {
    return found;
  }
  const wide = right - left > 2 * EDGE_MARGIN;
  const low = wide ? left + EDGE_MARGIN : left;
  const width = wide ? right - left - 2 * EDGE_MARGIN : right - left;
  return Array.from({ length: count }, (_, i) =>
    wide
      ? count === 1
        ? low + width / 2
        : low + (i * width) / (count - 1)
      : low + ((i + 1) * width) / (count + 1)
  );
}

interface Layout {
  gaps: readonly (readonly Range[])[];
  /** Heights held in each column. */
  held: Heights[];
}

function routeNet(
  { net, terminals, channels, lowest, highest }: Plan,
  laneOf: ReadonlyMap<number, number>,
  { gaps, held }: Layout
) {
  // crossing[j]: height at which the net crosses column j.
  const crossing = new Map<number, number>();
  const cross = (column: number, from: number) => {
    const y = nearestFree(gaps[column], from, held[column]);
    insertHeight(held[column].placed, y);
    crossing.set(column, y);
    return y;
  };
  let height = net.driver.y;
  for (let column = channels[0]; column < highest; column++) {
    height = cross(column, height);
  }
  height = net.driver.y;
  for (let column = channels[0] - 1; column >= lowest; column--) {
    height = cross(column, height);
  }

  // The next nets keep clear of these crossings in the channels beside their columns too.
  for (const [column, y] of crossing) {
    for (const beside of [column - 1, column + 1]) {
      if (held[beside]) {
        insertHeight(held[beside].placed, y);
      }
    }
  }

  const events = new Map<number, Set<number>>();
  const event = (channel: number, y: number) => {
    (events.get(channel) ?? events.set(channel, new Set()).get(channel)!).add(y);
  };
  terminals.forEach((terminal, i) => event(channels[i], terminal.y));
  for (const [column, y] of crossing) {
    event(column, y);
    event(column + 1, y);
  }

  const tree = new Tree();
  for (const [channel, ys] of events) {
    const sorted = [...ys].sort((a, b) => a - b);
    tree.add({ x: laneOf.get(channel)!, y: sorted[0] });
    sorted.slice(1).forEach((y, i) => {
      tree.link({ x: laneOf.get(channel)!, y: sorted[i] }, { x: laneOf.get(channel)!, y });
    });
  }
  terminals.forEach((terminal, i) => {
    tree.link(terminal, { x: laneOf.get(channels[i])!, y: terminal.y });
  });
  for (const [column, y] of crossing) {
    tree.link({ x: laneOf.get(column)!, y }, { x: laneOf.get(column + 1)!, y });
  }
  return tree;
}

/**
 * Routes every net around the obstacles (at least one), in request order.
 * `dataWires` are the polylines the lanes and crossings keep clear of; taps cross
 * them. The result is keyed by sink id.
 */
export function routeNets(
  obstacles: readonly Box[],
  nets: readonly NetRequest[],
  dataWires: readonly (readonly Point[])[]
): Map<string, RoutedWire> {
  const columns = columnsOf(obstacles);
  const plans = nets.map((net) => planOf(net, columns));
  const { verticals, horizontals } = dataOccupancy(columns, dataWires);
  // A crossing keeps clear of the terminals of the channels on both sides of its column.
  const held: Heights[] = horizontals.map((fixed) => ({ fixed, placed: [] }));
  for (const plan of plans) {
    plan.channels.forEach((channel, i) => {
      for (const column of [channel - 1, channel]) {
        held[column]?.fixed.push(plan.terminals[i].y);
      }
    });
  }
  held.forEach((heights) => heights.fixed.sort((a, b) => a - b));

  // laneOf[i]: lane x per channel of net i.
  const laneOf = plans.map(() => new Map<number, number>());
  for (let channel = 0; channel <= columns.length; channel++) {
    const users = plans.flatMap((plan, i) =>
      plan.lowest <= channel && channel <= plan.highest ? [i] : []
    );
    const order = laneOrder(users, plans, channel);
    const xs = lanePositions(columns, channel, verticals[channel], order.length);
    order.forEach((user, i) => laneOf[user].set(channel, xs[i]));
  }

  const layout: Layout = { gaps: columns.map(gapsOf), held };
  const routed = new Map<string, RoutedWire>();
  plans.forEach((plan, i) => {
    for (const [id, wire] of cutWires(
      plan.net.driver,
      plan.net.sinks,
      routeNet(plan, laneOf[i], layout)
    )) {
      routed.set(id, wire);
    }
  });
  return routed;
}
