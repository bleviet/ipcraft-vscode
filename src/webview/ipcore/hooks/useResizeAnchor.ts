import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import {
  clampPanToFit,
  layoutPointAt,
  panKeepingPoint,
  type Point,
} from '../components/canvas/canvasGeometry';

interface Options {
  containerRef: RefObject<HTMLDivElement | null>;
  viewBox: { width: number; height: number };
  zoom: number;
  currentPanRef: MutableRefObject<Point>;
  setPan: (pan: Point) => void;
  /** True while the details row is open, i.e. while its opening or growing resizes the canvas. */
  engaged: boolean;
}

/**
 * Keeps the symbol point under the pointer fixed when the canvas is resized by the details row. Opening the row
 * shrinks the canvas, which re-fits the symbol; without this the clicked bus would slide away from the pointer and
 * the pointer would land on a different bus. The pan never moves the symbol out of the canvas where it fits, so it is
 * not hidden behind the row; the anchor is then as close as that allows. The pan applied this way is undone once the row has closed with the
 * pointer outside the canvas, so the symbol returns to where it was. Unrelated resizes are left alone.
 */
export function useResizeAnchor({
  containerRef,
  viewBox,
  zoom,
  currentPanRef,
  setPan,
  engaged,
}: Options): void {
  const live = useRef({ viewBox, zoom, engaged });
  live.current = { viewBox, zoom, engaged };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') {
      return;
    }
    let pointer: Point | null = null;
    let lastRect: DOMRect | null = null;
    let shift: Point = { x: 0, y: 0 };

    const apply = (next: Point) => {
      currentPanRef.current = next;
      flushSync(() => setPan(next));
    };
    const onMove = (e: MouseEvent) => {
      pointer = { x: e.clientX, y: e.clientY };
    };
    const onLeave = () => {
      pointer = null;
    };
    const onResize = () => {
      const rect = container.getBoundingClientRect();
      const prev = lastRect;
      lastRect = rect;
      if (!prev || rect.width === 0 || rect.height === 0 || prev.width === 0 || prev.height === 0) {
        return;
      }
      const { viewBox: vb, zoom: z, engaged: open } = live.current;
      const pan = currentPanRef.current;
      const shifted = shift.x !== 0 || shift.y !== 0;
      if (pointer && (open || shifted)) {
        const point = layoutPointAt(vb, prev, pan, z, {
          x: pointer.x - prev.left,
          y: pointer.y - prev.top,
        });
        const next = clampPanToFit(
          vb,
          rect,
          z,
          panKeepingPoint(vb, rect, z, point, { x: pointer.x - rect.left, y: pointer.y - rect.top })
        );
        shift = { x: shift.x + next.x - pan.x, y: shift.y + next.y - pan.y };
        apply(next);
      } else if (!pointer && !open && shifted) {
        apply({ x: pan.x - shift.x, y: pan.y - shift.y });
        shift = { x: 0, y: 0 };
      }
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(container);
    container.addEventListener('mousemove', onMove);
    container.addEventListener('mouseleave', onLeave);
    return () => {
      observer.disconnect();
      container.removeEventListener('mousemove', onMove);
      container.removeEventListener('mouseleave', onLeave);
    };
  }, [containerRef, currentPanRef, setPan]);
}
