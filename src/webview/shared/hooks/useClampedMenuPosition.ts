import { useCallback, useLayoutEffect, useRef, useState } from 'react';

export interface MenuPosition {
  x: number;
  y: number;
}

const MARGIN = 4;

export function useClampedMenuPosition(position: MenuPosition | null) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [adjusted, setAdjusted] = useState<MenuPosition | null>(position);

  const x = position?.x;
  const y = position?.y;

  const clamp = useCallback((pos: MenuPosition) => {
    const el = menuRef.current;
    if (!el) {
      setAdjusted(pos);
      return;
    }
    const rect = el.getBoundingClientRect();
    const menuW = rect.width;
    const menuH = rect.height;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = pos.x;
    let top = pos.y;

    if (left + menuW > vw - MARGIN) {
      left = Math.max(MARGIN, vw - menuW - MARGIN);
    }
    if (left < MARGIN) {
      left = MARGIN;
    }

    if (top + menuH > vh - MARGIN) {
      const flipped = pos.y - menuH;
      if (flipped >= MARGIN) {
        top = flipped;
      } else {
        top = Math.max(MARGIN, vh - menuH - MARGIN);
      }
    }
    if (top < MARGIN) {
      top = MARGIN;
    }

    setAdjusted({ x: left, y: top });
  }, []);

  useLayoutEffect(() => {
    if (x === undefined || y === undefined) {
      setAdjusted(null);
      return;
    }
    clamp({ x, y });
  }, [x, y, clamp]);

  return { menuRef, adjusted: adjusted ?? position };
}
