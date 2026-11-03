/** Pure sizing rules for the resizable outline, details, and bottom panels. */

/** Which side of the workbench a panel is docked to. */
export type PanelEdge = 'left' | 'right' | 'bottom';

export interface PanelLimits {
  min: number;
  max: number;
}

export const KEY_STEP = 16;
const SIDE_LIMITS: PanelLimits = { min: 160, max: 600 };
const BOTTOM_MIN = 80;
const BOTTOM_MAX_RATIO = 0.7;

export const DEFAULT_PANEL_SIZES: Record<PanelEdge, number> = {
  left: 260,
  right: 320,
  bottom: 200,
};

/** `containerSize` is the workbench height; it only affects the bottom panel. */
export function limitsFor(edge: PanelEdge, containerSize: number): PanelLimits {
  if (edge !== 'bottom') {
    return SIDE_LIMITS;
  }
  return {
    min: BOTTOM_MIN,
    max: Math.max(BOTTOM_MIN, Math.floor(containerSize * BOTTOM_MAX_RATIO)),
  };
}

export function clampSize(size: number, limits: PanelLimits): number {
  return Math.min(Math.max(size, limits.min), limits.max);
}

/** Panel size implied by a pointer position inside the container rectangle. */
export function sizeFromPointer(
  edge: PanelEdge,
  pointer: { x: number; y: number },
  rect: { left: number; right: number; bottom: number }
): number {
  switch (edge) {
    case 'left':
      return pointer.x - rect.left;
    case 'right':
      return rect.right - pointer.x;
    case 'bottom':
      return rect.bottom - pointer.y;
  }
}

/** Size change for an arrow key on the panel's separator; 0 for other keys. */
export function keyboardDelta(edge: PanelEdge, key: string): number {
  const grow: Record<PanelEdge, string> = {
    left: 'ArrowRight',
    right: 'ArrowLeft',
    bottom: 'ArrowUp',
  };
  const shrink: Record<PanelEdge, string> = {
    left: 'ArrowLeft',
    right: 'ArrowRight',
    bottom: 'ArrowDown',
  };
  if (key === grow[edge]) {
    return KEY_STEP;
  }
  return key === shrink[edge] ? -KEY_STEP : 0;
}
