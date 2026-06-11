import React, { useRef, useState } from 'react';

export interface UseHoverInsertBarReturn {
  insertHoverGap: number | null;
  insertBarScrollY: number | null;
  tbodyProps: {
    onMouseMove: (e: React.MouseEvent<HTMLTableSectionElement>) => void;
    onMouseLeave: () => void;
  };
  barProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  clear: () => void;
}

export function useHoverInsertBar(
  containerRef: React.RefObject<HTMLElement>
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

  const handleTbodyMouseMove = (e: React.MouseEvent<HTMLTableSectionElement>) => {
    cancelInsertClear();
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('tr[data-row-idx]'));
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
