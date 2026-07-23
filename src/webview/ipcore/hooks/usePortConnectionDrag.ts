import { useCallback, useEffect, useRef, useState } from 'react';
import { euclideanExceeds } from '../components/canvas/canvasGeometry';

const DRAG_THRESHOLD = 5;

/**
 * Pointer-event drag of a port stub onto a bus bundle, to merge it into that
 * interface. HTML5 DnD on SVG `<g>` elements is unreliable in VS Code webviews,
 * so this uses pointermove/pointerup instead. Extracted from IpBlockCanvas
 * (issue #129).
 */
export function usePortConnectionDrag(onDrop: (portIndex: number, busIndex: number) => void) {
  const portDragRef = useRef<{
    portIndex: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const [portDragActive, setPortDragActive] = useState(false);
  const [portDragActivePIdx, setPortDragActivePIdx] = useState<number | null>(null);

  const portDragHoveredBusRef = useRef<number | null>(null);
  const [portDragHoveredBus, setPortDragHoveredBus] = useState<number | null>(null);

  // Keep a stable ref so the effect closure can call the latest handler.
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  const handlePortPointerDragStart = useCallback(
    (portIndex: number, clientX: number, clientY: number) => {
      portDragRef.current = { portIndex, startX: clientX, startY: clientY, moved: false };
      setPortDragActivePIdx(portIndex);
    },
    []
  );

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const drag = portDragRef.current;
      if (!drag) {
        return;
      }

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (!drag.moved && euclideanExceeds(dx, dy, DRAG_THRESHOLD)) {
        drag.moved = true;
        setPortDragActive(true);
      }

      if (drag.moved) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const bundleEl = el?.closest('[data-port-id^="bus:"]');
        const busIndex = bundleEl
          ? parseInt(bundleEl.getAttribute('data-port-id')?.split(':')[1] ?? '-1', 10)
          : -1;
        const next = busIndex >= 0 ? busIndex : null;
        if (next !== portDragHoveredBusRef.current) {
          portDragHoveredBusRef.current = next;
          setPortDragHoveredBus(next);
        }
      }
    };

    const onPointerUp = () => {
      const drag = portDragRef.current;
      if (!drag) {
        return;
      }
      portDragRef.current = null;
      setPortDragActive(false);
      setPortDragActivePIdx(null);

      const busIndex = portDragHoveredBusRef.current;
      portDragHoveredBusRef.current = null;
      setPortDragHoveredBus(null);

      if (drag.moved && busIndex !== null) {
        onDropRef.current(drag.portIndex, busIndex);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  return {
    portDragActive,
    portDragActivePIdx,
    portDragHoveredBus,
    handlePortPointerDragStart,
  };
}
