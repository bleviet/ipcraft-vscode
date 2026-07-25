import { useCallback, useState } from 'react';
import {
  DRAG_MIME,
  PORT_MOVE_MIME,
  REMOVE_MIME,
  parseRemoveDragPayload,
} from '../components/canvas/canvasDragTypes';
import { dropHalfSide } from '../components/canvas/canvasGeometry';

/**
 * HTML5 drag/drop presentation state for the canvas: hover highlighting while
 * dragging a library-palette item in, the remove-zone highlight while dragging
 * a port out, and the half-zone (left/right) drop hint. Extracted from
 * IpBlockCanvas (issue #129).
 */
export function useCanvasDropTarget(opts: {
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onRemove?: (kind: string, id: string) => void;
}) {
  const [dragActive, setDragActive] = useState(false);
  const [dragOutActive, setDragOutActive] = useState(false);
  const [dragHoverSide, setDragHoverSide] = useState<'left' | 'right' | null>(null);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      // When dragging a port-to-bus (PORT_MOVE_MIME present), don't show the
      // RemoveZone — the user is targeting a bus bundle, not deleting the port.
      if (e.dataTransfer.types.includes(REMOVE_MIME)) {
        if (!e.dataTransfer.types.includes(PORT_MOVE_MIME)) {
          e.preventDefault();
          setDragOutActive(true);
        }
        return;
      }

      setDragActive(true);

      if (e.dataTransfer.types.includes(DRAG_MIME)) {
        const svgEl = e.currentTarget;
        const rect = svgEl.getBoundingClientRect();
        setDragHoverSide(dropHalfSide(e.clientX, rect));
      }

      opts.onDragOver?.(e);
    },
    [opts]
  );

  const handleDragLeave = useCallback(() => {
    setDragActive(false);
    setDragOutActive(false);
    setDragHoverSide(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setDragActive(false);
      setDragOutActive(false);
      setDragHoverSide(null);

      if (e.dataTransfer.types.includes(REMOVE_MIME)) {
        const payload = parseRemoveDragPayload(e.dataTransfer.getData(REMOVE_MIME));
        if (payload) {
          opts.onRemove?.(payload.kind, payload.id);
        }
        return;
      }

      opts.onDrop?.(e);
    },
    [opts]
  );

  const handleDragEnd = useCallback(() => setDragOutActive(false), []);

  return {
    dragActive,
    dragOutActive,
    dragHoverSide,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
  };
}
