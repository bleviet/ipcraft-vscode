/** Auto detail: what is drawn at a zoom scale. Pure; it never feeds the layout. */

/** Below this zoom scale the diagram is "far": pin text goes and block names grow. */
export const FAR_ZOOM = 0.42;
/** A block name never grows beyond this many times its size. */
export const MAX_NAME_SCALE = 3;
/** The name scale is written in steps of this size, so a zoom gesture restyles the canvas rarely. */
export const NAME_SCALE_STEP = 0.25;

export const isFar = (zoom: number): boolean => zoom < FAR_ZOOM;

/** Factor that keeps a block name at its on-screen size as the zoom shrinks. */
export const nameScale = (zoom: number): number => Math.min(1 / zoom, MAX_NAME_SCALE);

/** The name scale to draw at `zoom`, in `NAME_SCALE_STEP`s; undefined while the zoom is not far. */
export const farNameScale = (zoom: number): number | undefined =>
  isFar(zoom) ? Math.round(nameScale(zoom) / NAME_SCALE_STEP) * NAME_SCALE_STEP : undefined;

/**
 * The factor that makes a ring of `2px * scale` at least 2 screen pixels wide at `zoom`: the smallest
 * power of two of at least `1 / zoom` (powers of two, so a zoom gesture restyles the canvas rarely),
 * not capped like the name scale; undefined while the zoom is not far.
 */
export const farRingScale = (zoom: number): number | undefined =>
  isFar(zoom) ? 2 ** Math.ceil(Math.log2(1 / zoom)) : undefined;
