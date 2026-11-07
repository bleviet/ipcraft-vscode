/** Pure edge-route helper: ELK ends wires at the outer edge of a port box. */

interface Point {
  x: number;
  y: number;
}

function extend(from: Point, to: Point, by: number): Point {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  return length === 0
    ? to
    : { x: to.x + ((to.x - from.x) / length) * by, y: to.y + ((to.y - from.y) / length) * by };
}

/**
 * Pushes the route ends `start` and `end` px further along their last
 * segments (both `start` when `end` is omitted), so wires reach the centre of
 * the pin marker (which covers them) rather than stopping at its outer edge,
 * whatever the marker shape. A negative value pulls the end back instead, for a
 * wire that meets a pin from inside a frame.
 */
export function extendRouteEnds(
  points: readonly Point[],
  start: number,
  end: number = start
): Point[] {
  if (points.length < 2) {
    return [...points];
  }
  const last = points.length - 1;
  return [
    extend(points[1], points[0], start),
    ...points.slice(1, last),
    extend(points[last - 1], points[last], end),
  ];
}

/** Midpoint of the longest segment of a route (the first of equals); undefined for fewer than two points. */
export function longestSegmentMidpoint(points: readonly Point[]): Point | undefined {
  let best: { length: number; at: Point } | undefined;
  for (let i = 1; i < points.length; i += 1) {
    const length = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (!best || length > best.length) {
      best = {
        length,
        at: { x: (points[i].x + points[i - 1].x) / 2, y: (points[i].y + points[i - 1].y) / 2 },
      };
    }
  }
  return best?.at;
}
