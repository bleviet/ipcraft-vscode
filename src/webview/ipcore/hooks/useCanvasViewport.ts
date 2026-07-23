import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  isCanvasBackground,
  manhattanExceeds,
  nextZoomForWheel,
  panAfterDrag,
  panAfterWheel,
  type Point,
} from '../components/canvas/canvasGeometry';

const PAN_DRAG_THRESHOLD = 4;

/**
 * Canvas zoom/pan viewport: Ctrl+Wheel zoom, plain-wheel pan, Space+drag or
 * middle-mouse-drag pan, and reset-to-center. Extracted from IpBlockCanvas
 * (issue #129) — pure math lives in canvasGeometry.ts.
 *
 * `hasDraggedRef` is exposed so callers (background click, marquee selection)
 * can suppress a click/deselect that was actually the tail end of a pan-drag.
 */
export function useCanvasViewport(containerRef: RefObject<HTMLDivElement | null>) {
  const [zoom, setZoom] = useState(1.0);
  const [showZoomIndicator, setShowZoomIndicator] = useState(false);
  const zoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const currentPanRef = useRef<Point>({ x: 0, y: 0 });
  const dragRef = useRef<{
    startMouse: Point;
    startPan: Point;
    hasMoved: boolean;
  } | null>(null);
  const hasDraggedRef = useRef(false);

  const spaceDownRef = useRef(false);
  const [spaceDown, setSpaceDown] = useState(false);

  const triggerZoomIndicator = useCallback(() => {
    setShowZoomIndicator(true);
    if (zoomTimerRef.current) {
      clearTimeout(zoomTimerRef.current);
    }
    zoomTimerRef.current = setTimeout(() => setShowZoomIndicator(false), 1500);
  }, []);

  const resetView = useCallback(() => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
    currentPanRef.current = { x: 0, y: 0 };
    triggerZoomIndicator();
  }, [triggerZoomIndicator]);

  // Ctrl+Wheel → zoom; plain wheel → pan
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        setZoom((prev) => nextZoomForWheel(prev, e.deltaY));
        triggerZoomIndicator();
      } else {
        const next = panAfterWheel(currentPanRef.current, e.deltaX, e.deltaY);
        currentPanRef.current = next;
        setPan(next);
      }
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [containerRef, triggerZoomIndicator]);

  // Space key → pan-by-drag mode; suppress Space scroll in canvas
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.code === 'Space' && !e.repeat) {
        spaceDownRef.current = true;
        setSpaceDown(true);
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDownRef.current = false;
        setSpaceDown(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Middle-mouse-button drag + Space+left-drag on canvas background → pan
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const onMouseDown = (e: MouseEvent) => {
      const isMiddle = e.button === 1;
      const isSpaceLeftBackground =
        e.button === 0 && spaceDownRef.current && isCanvasBackground(e.target);
      if (!isMiddle && !isSpaceLeftBackground) {
        return;
      }
      if (isMiddle) {
        e.preventDefault(); // suppress browser auto-scroll cursor
      }
      hasDraggedRef.current = false;
      dragRef.current = {
        startMouse: { x: e.clientX, y: e.clientY },
        startPan: { ...currentPanRef.current },
        hasMoved: false,
      };
    };

    const onMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) {
        return;
      }
      const dx = e.clientX - drag.startMouse.x;
      const dy = e.clientY - drag.startMouse.y;
      if (!drag.hasMoved && manhattanExceeds(dx, dy, PAN_DRAG_THRESHOLD)) {
        drag.hasMoved = true;
        hasDraggedRef.current = true;
        setIsPanning(true);
      }
      if (drag.hasMoved) {
        const next = panAfterDrag(drag.startPan, drag.startMouse, { x: e.clientX, y: e.clientY });
        currentPanRef.current = next;
        setPan(next);
      }
    };

    const onMouseUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        setIsPanning(false);
      }
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [containerRef]);

  return {
    zoom,
    setZoom,
    pan,
    setPan,
    currentPanRef,
    isPanning,
    spaceDown,
    spaceDownRef,
    showZoomIndicator,
    hasDraggedRef,
    triggerZoomIndicator,
    resetView,
  };
}
