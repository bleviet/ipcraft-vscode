import React, { useRef, useState } from 'react';

export interface UseHoverInsertBarReturn {
  insertHoverGap: number | null;
  insertBarScrollY: number | null;
  tbodyProps: {
    onMouseMove: (e: React.MouseEvent<HTMLElement>) => void;
    onMouseLeave: () => void;
  };
  barProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  clear: () => void;
}

/**
 * Tracks the nearest row-boundary gap while the mouse moves over a row
 * container, for rendering a hover "insert here" line/button.
 *
 * @param rowSelector CSS selector matching the individual row elements to
 * measure gaps between (e.g. `'tr[data-reg-idx]'` for a table, or
 * `'[data-outline-row]'` for tree rows rendered as plain divs).
 */
export function useHoverInsertBar(
  containerRef: React.RefObject<HTMLElement>,
  rowSelector: string
): UseHoverInsertBarReturn {
  const [insertHoverGap, setInsertHoverGap] = useState<number | null>(null);
  const [insertBarScrollY, setInsertBarScrollY] = useState<number | null>(null);
  const insertClearRef = useRef<number | null>(null);

  const scheduleInsertClear = () => {
    if (insertClearRef.current) {
      clearTimeout(insertClearRef.current);
    }
    insertClearRef.current = window.setTimeout(() => {
      setInsertHoverGap(null);
      setInsertBarScrollY(null);
    }, 150);
  };

  const cancelInsertClear = () => {
    if (insertClearRef.current) {
      clearTimeout(insertClearRef.current);
      insertClearRef.current = null;
    }
  };

  const handleTbodyMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    cancelInsertClear();
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(rowSelector));
    if (rows.length === 0) {
      return;
    }
    const THRESHOLD = 12;
    const mouseY = e.clientY;
    for (let i = 0; i <= rows.length; i++) {
      const gapViewportY =
        i === 0 ? rows[0].getBoundingClientRect().top : rows[i - 1].getBoundingClientRect().bottom;
      if (Math.abs(mouseY - gapViewportY) < THRESHOLD) {
        const containerEl = containerRef.current;
        if (containerEl) {
          const cRect = containerEl.getBoundingClientRect();
          setInsertHoverGap(i);
          setInsertBarScrollY(gapViewportY - cRect.top + containerEl.scrollTop);
        }
        return;
      }
    }
    scheduleInsertClear();
  };

  const clear = () => {
    setInsertHoverGap(null);
    setInsertBarScrollY(null);
  };

  return {
    insertHoverGap,
    insertBarScrollY,
    tbodyProps: {
      onMouseMove: handleTbodyMouseMove,
      onMouseLeave: scheduleInsertClear,
    },
    barProps: {
      onMouseEnter: cancelInsertClear,
      onMouseLeave: scheduleInsertClear,
    },
    clear,
  };
}
