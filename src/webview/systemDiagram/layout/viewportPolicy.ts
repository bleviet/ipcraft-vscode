/** Pure policy for what the viewport does when a layout is shown. */

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export type ViewportAction =
  | { kind: 'fit' }
  | { kind: 'restore'; viewport: Viewport }
  | { kind: 'keep' };

/**
 * Saved viewports after `level` stops being shown, either because the user
 * left it or because its layout became unavailable (a layout error unmounts
 * the canvas, and React Flow resets the viewport when it remounts). The
 * caller then treats no level as shown, so the next good layout goes through
 * {@link decideViewportAction} and restores or fits.
 */
export function withSavedViewport(
  saved: ReadonlyMap<string, Viewport>,
  level: string | null,
  viewport: Viewport
): ReadonlyMap<string, Viewport> {
  return level === null ? saved : new Map(saved).set(level, viewport);
}

/**
 * `shownLevel` is the level whose layout was displayed before, null on the
 * first layout. A new layout of the same level keeps the viewport; a different
 * level restores its saved viewport, or fits on the first visit.
 */
export function decideViewportAction(
  shownLevel: string | null,
  layoutLevel: string,
  saved: ReadonlyMap<string, Viewport>
): ViewportAction {
  if (shownLevel === layoutLevel) {
    return { kind: 'keep' };
  }
  const viewport = saved.get(layoutLevel);
  return viewport ? { kind: 'restore', viewport } : { kind: 'fit' };
}
