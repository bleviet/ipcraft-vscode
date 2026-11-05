export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const GAP = 8;
const MARGIN = 4;

/**
 * Viewport position of the hover card: beside the anchor on the side away from
 * its node (right of an east pin, left of a west pin), flipped when it would
 * leave the viewport, and clamped vertically.
 */
export function placeHoverCard(
  anchor: Box,
  side: 'west' | 'east',
  card: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number } {
  const right = anchor.right + GAP;
  const left = anchor.left - GAP - card.width;
  const fitsRight = right + card.width <= viewport.width - MARGIN;
  const fitsLeft = left >= MARGIN;
  const useRight = side === 'east' ? fitsRight || !fitsLeft : !fitsLeft && fitsRight;
  const x = useRight ? right : left;
  const maxTop = Math.max(MARGIN, viewport.height - card.height - MARGIN);
  return {
    left: Math.max(MARGIN, x),
    top: Math.min(Math.max(MARGIN, anchor.top), maxTop),
  };
}
