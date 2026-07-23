/**
 * Pure geometry helpers for IpBlockCanvas interaction (zoom, pan, marquee selection,
 * and drag hit-testing). Kept free of DOM event wiring and React state so the
 * math can be unit-tested directly (issue #129).
 */

export const CANVAS_ZOOM_MIN = 0.1;
export const CANVAS_ZOOM_MAX = 4;

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MarqueeDrag {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

/** Ctrl+Wheel zoom step, clamped to [CANVAS_ZOOM_MIN, CANVAS_ZOOM_MAX] and rounded to 2 decimals. */
export function nextZoomForWheel(prevZoom: number, deltaY: number): number {
  const factor = deltaY > 0 ? 0.9 : 1.1;
  const next = Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, prevZoom * factor));
  return Math.round(next * 100) / 100;
}

/** Plain-wheel pan (trackpad/scroll-wheel deltas map directly onto pan offset). */
export function panAfterWheel(pan: Point, deltaX: number, deltaY: number): Point {
  return { x: pan.x - deltaX, y: pan.y - deltaY };
}

/** Pan resulting from a mouse-drag gesture, given the pan value when the drag started. */
export function panAfterDrag(startPan: Point, startMouse: Point, currentMouse: Point): Point {
  return {
    x: startPan.x + (currentMouse.x - startMouse.x),
    y: startPan.y + (currentMouse.y - startMouse.y),
  };
}

/** Manhattan-distance drag threshold — used by canvas pan-drag and marquee-drag start detection. */
export function manhattanExceeds(dx: number, dy: number, threshold: number): boolean {
  return Math.abs(dx) + Math.abs(dy) > threshold;
}

/** Euclidean-distance drag threshold — used by the port-to-bus pointer drag. */
export function euclideanExceeds(dx: number, dy: number, threshold: number): boolean {
  return Math.sqrt(dx * dx + dy * dy) > threshold;
}

/** Marquee rectangle in container-local coordinates, for rendering the selection box. */
export function computeMarqueeRect(
  drag: MarqueeDrag,
  containerRect: { left: number; top: number }
): { left: number; top: number; width: number; height: number } {
  return {
    left: Math.min(drag.startX, drag.endX) - containerRect.left,
    top: Math.min(drag.startY, drag.endY) - containerRect.top,
    width: Math.abs(drag.endX - drag.startX),
    height: Math.abs(drag.endY - drag.startY),
  };
}

/** True when `rect` (viewport coordinates) overlaps the marquee drag's bounding box. */
export function rectIntersectsMarquee(rect: Rect, drag: MarqueeDrag): boolean {
  const minX = Math.min(drag.startX, drag.endX);
  const maxX = Math.max(drag.startX, drag.endX);
  const minY = Math.min(drag.startY, drag.endY);
  const maxY = Math.max(drag.startY, drag.endY);
  return rect.left < maxX && rect.right > minX && rect.top < maxY && rect.bottom > minY;
}

/** Which half of `rect` a client-X coordinate falls in — drives the drag-drop IN/OUT hint. */
export function dropHalfSide(
  clientX: number,
  rect: { left: number; width: number }
): 'left' | 'right' {
  return (clientX - rect.left) / rect.width < 0.5 ? 'left' : 'right';
}

/** True when `target` is the inert SVG background (not a port or other interactive element). */
export function isCanvasBackground(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) {
    return false;
  }
  return (
    target.classList.contains('ip-canvas-background') || target.tagName.toLowerCase() === 'svg'
  );
}
