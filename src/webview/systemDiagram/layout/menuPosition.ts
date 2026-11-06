/** Top-left of a context menu opened at (x, y), kept inside a canvas of the given size. */
export function clampMenuPosition(
  x: number,
  y: number,
  menu: { width: number; height: number },
  canvas: { width: number; height: number }
): { left: number; top: number } {
  return {
    left: Math.max(0, Math.min(x, canvas.width - menu.width)),
    top: Math.max(0, Math.min(y, canvas.height - menu.height)),
  };
}
