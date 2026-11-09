/**
 * The tree of one routed net (issue #283): the points the trunks, taps and
 * crossings meet in, and its cut into one polyline per sink. Knows points only.
 */

export interface Point {
  x: number;
  y: number;
}

export interface RoutedWire {
  points: Point[];
  /** Starts on the net's tree, not at the driver: draw a junction dot at points[0]. */
  junction: boolean;
  /** Junction wires only: the tree path from the driver terminal to `points[0]`. */
  lead?: Point[];
}

export const keyOf = (point: Point) => `${point.x},${point.y}`;

/** Adjacency of the points of one net's tree, in insertion order. */
export class Tree {
  readonly points = new Map<string, Point>();
  private readonly next = new Map<string, string[]>();

  add(point: Point): string {
    const key = keyOf(point);
    if (!this.points.has(key)) {
      this.points.set(key, { x: point.x, y: point.y });
      this.next.set(key, []);
    }
    return key;
  }

  link(a: Point, b: Point): void {
    const from = this.add(a);
    const to = this.add(b);
    if (from !== to) {
      this.next.get(from)!.push(to);
      this.next.get(to)!.push(from);
    }
  }

  /** Parent and walking distance from `root` of every point reachable from it. */
  walk(root: string): { parent: Map<string, string>; distance: Map<string, number> } {
    const parent = new Map<string, string>();
    const distance = new Map([[root, 0]]);
    const queue = [root];
    for (let i = 0; i < queue.length; i++) {
      const from = this.points.get(queue[i])!;
      for (const key of this.next.get(queue[i])!) {
        if (!distance.has(key)) {
          const to = this.points.get(key)!;
          distance.set(
            key,
            distance.get(queue[i])! + Math.abs(to.x - from.x) + Math.abs(to.y - from.y)
          );
          parent.set(key, queue[i]);
          queue.push(key);
        }
      }
    }
    return { parent, distance };
  }
}

/** Drops repeated points and the middle of collinear runs. */
function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (last?.x === point.x && last.y === point.y) {
      continue;
    }
    while (out.length >= 2) {
      const a = out[out.length - 2];
      const b = out[out.length - 1];
      if (!((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y))) {
        break;
      }
      out.pop();
    }
    out.push(point);
  }
  return out;
}

/** One polyline per sink: its tree path, from the nearest earlier wire (or the driver) to the sink. */
export function cutWires(
  driver: Point,
  sinks: readonly { id: string; terminal: Point }[],
  tree: Tree
): Map<string, RoutedWire> {
  const root = keyOf(driver);
  const { parent, distance } = tree.walk(root);
  const paths = sinks
    .map((sink) => ({ sink, key: keyOf(sink.terminal) }))
    .sort((a, b) => (distance.get(a.key) ?? Infinity) - (distance.get(b.key) ?? Infinity));
  const covered = new Set([root]);
  const wires = new Map<string, RoutedWire>();
  for (const { sink, key: start } of paths) {
    const walked = [start];
    while (!covered.has(walked[walked.length - 1]) && parent.has(walked[walked.length - 1])) {
      walked.push(parent.get(walked[walked.length - 1])!);
    }
    walked.forEach((key) => covered.add(key));
    const attach = walked[walked.length - 1];
    const points = simplify(walked.reverse().map((key) => tree.points.get(key)!));
    const wire: RoutedWire = { points, junction: attach !== root };
    if (wire.junction) {
      const back = [attach];
      while (back[back.length - 1] !== root) {
        back.push(parent.get(back[back.length - 1])!);
      }
      wire.lead = simplify(back.reverse().map((key) => tree.points.get(key)!));
    }
    wires.set(sink.id, wire);
  }
  return wires;
}
