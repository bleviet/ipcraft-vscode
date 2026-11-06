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
 * Pushes both route ends `by` px further along their last segments, so wires
 * reach the centre of the pin marker (which covers them) rather than stopping
 * at its outer edge, whatever the marker shape.
 */
export function extendRouteEnds(points: readonly Point[], by: number): Point[] {
  if (points.length < 2) {
    return [...points];
  }
  const last = points.length - 1;
  return [
    extend(points[1], points[0], by),
    ...points.slice(1, last),
    extend(points[last - 1], points[last], by),
  ];
}
