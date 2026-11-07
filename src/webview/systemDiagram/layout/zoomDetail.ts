/** Auto detail: what is drawn at a zoom scale. Pure; it never feeds the layout. */

/** Below this zoom scale the diagram is "far": pin text goes and block names grow. */
export const FAR_ZOOM = 0.42;
/** A block name never grows beyond this many times its size. */
export const MAX_NAME_SCALE = 3;

export const isFar = (zoom: number): boolean => zoom < FAR_ZOOM;

/** Factor that keeps a block name at its on-screen size as the zoom shrinks. */
export const nameScale = (zoom: number): number => Math.min(1 / zoom, MAX_NAME_SCALE);
