/**
 * Zoom for revealing a search match: never zooms out, zooms in to at most the
 * readable level, and never past the zoom at which the node still fits.
 */
export function revealZoom(current: number, fitZoom: number, minReadable = 0.8): number {
  return Math.max(current, Math.min(minReadable, fitZoom));
}
