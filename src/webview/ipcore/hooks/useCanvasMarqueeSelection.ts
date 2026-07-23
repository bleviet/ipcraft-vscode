import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from 'react';
import {
  computeMarqueeRect,
  isCanvasBackground,
  manhattanExceeds,
  rectIntersectsMarquee,
  type MarqueeDrag,
} from '../components/canvas/canvasGeometry';

const MARQUEE_THRESHOLD = 4;

/**
 * Left-drag-on-background marquee selection: draws a selection rectangle and,
 * on release, shift-selects every port/interrupt element it overlaps.
 * Extracted from IpBlockCanvas (issue #129).
 *
 * Skips the gesture while `spaceDownRef` is true (that combination pans instead),
 * and reports through `hasDraggedRef` so a marquee-drag doesn't also fire the
 * background click's deselect.
 */
export function useCanvasMarqueeSelection(
  containerRef: RefObject<HTMLDivElement | null>,
  spaceDownRef: RefObject<boolean>,
  hasDraggedRef: MutableRefObject<boolean>,
  onShiftSelect?: (id: string) => void
) {
  const marqueeRef = useRef<(MarqueeDrag & { active: boolean }) | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || !isCanvasBackground(e.target) || spaceDownRef.current) {
        return;
      }
      marqueeRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        endX: e.clientX,
        endY: e.clientY,
        active: false,
      };
    };

    const onMouseMove = (e: MouseEvent) => {
      const drag = marqueeRef.current;
      if (!drag) {
        return;
      }
      drag.endX = e.clientX;
      drag.endY = e.clientY;
      const dx = drag.endX - drag.startX;
      const dy = drag.endY - drag.startY;
      if (!drag.active && manhattanExceeds(dx, dy, MARQUEE_THRESHOLD)) {
        drag.active = true;
        hasDraggedRef.current = true;
      }
      if (drag.active) {
        setMarqueeRect(computeMarqueeRect(drag, container.getBoundingClientRect()));
      }
    };

    const onMouseUp = () => {
      const drag = marqueeRef.current;
      if (!drag?.active) {
        marqueeRef.current = null;
        setMarqueeRect(null);
        return;
      }
      const portEls = container.querySelectorAll(
        '[data-port-id^="port:"], [data-port-id^="interrupt:"]'
      );
      portEls.forEach((el) => {
        if (rectIntersectsMarquee(el.getBoundingClientRect(), drag)) {
          const portId = el.getAttribute('data-port-id');
          if (portId) {
            onShiftSelect?.(portId);
          }
        }
      });
      marqueeRef.current = null;
      setMarqueeRect(null);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && marqueeRef.current) {
        marqueeRef.current = null;
        setMarqueeRect(null);
      }
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [containerRef, spaceDownRef, hasDraggedRef, onShiftSelect]);

  return { marqueeRect };
}
