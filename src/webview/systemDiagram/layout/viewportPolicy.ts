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

const ISOLATE_MARK = '#isolate:';

/** View key of one isolation of a level; the level path itself is the key of its full view. */
export function isolatedViewKey(levelPath: string, token: number): string {
  return `${levelPath}${ISOLATE_MARK}${token}`;
}

/**
 * Saved viewports after the view `viewKey` stops being shown, either because
 * the user left it or because its layout became unavailable (a layout error
 * unmounts the canvas, and React Flow resets the viewport when it remounts).
 * The caller then treats no view as shown, so the next good layout goes
 * through {@link decideViewportAction} and restores or fits. An isolated view
 * is not saved: a new isolation always fits.
 */
export function withSavedViewport(
  saved: ReadonlyMap<string, Viewport>,
  viewKey: string | null,
  viewport: Viewport
): ReadonlyMap<string, Viewport> {
  return viewKey === null || viewKey.includes(ISOLATE_MARK)
    ? saved
    : new Map(saved).set(viewKey, viewport);
}

/**
 * `shownKey` is the view key of the layout displayed before, null on the first
 * layout. A new layout of the same view keeps the viewport; a different view
 * restores its saved viewport, or fits on the first visit.
 */
export function decideViewportAction(
  shownKey: string | null,
  layoutKey: string,
  saved: ReadonlyMap<string, Viewport>
): ViewportAction {
  if (shownKey === layoutKey) {
    return { kind: 'keep' };
  }
  const viewport = saved.get(layoutKey);
  return viewport ? { kind: 'restore', viewport } : { kind: 'fit' };
}
