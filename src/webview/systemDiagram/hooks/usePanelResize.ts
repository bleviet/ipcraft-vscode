import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  clampSize,
  DEFAULT_PANEL_SIZES,
  keyboardDelta,
  limitsFor,
  sizeFromPointer,
  type PanelEdge,
} from '../layout/panelSizes';

export interface SeparatorProps {
  orientation: 'vertical' | 'horizontal';
  value: number;
  min: number;
  max: number;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  onLostPointerCapture: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
}

export interface PanelResize {
  size: number;
  collapsed: boolean;
  toggle: () => void;
  separator: SeparatorProps;
}

/**
 * Size, collapsed state, and the drag and keyboard lifecycle of one panel.
 * `containerRef` is the element the panel is docked inside; the size is
 * re-clamped when the window resizes. Collapsing keeps the size for restore.
 */
export function usePanelResize(
  edge: PanelEdge,
  containerRef: RefObject<HTMLElement | null>
): PanelResize {
  const [size, setSize] = useState(DEFAULT_PANEL_SIZES[edge]);
  const [collapsed, setCollapsed] = useState(false);
  const [containerSize, setContainerSize] = useState(0);
  const dragging = useRef(false);
  const limits = limitsFor(edge, containerSize);
  const current = clampSize(size, limits);

  const measure = useCallback(() => {
    const rect = containerRef.current?.getBoundingClientRect();
    setContainerSize(rect?.height ?? 0);
    return rect;
  }, [containerRef]);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    dragging.current = true;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // setPointerCapture is unavailable in jsdom; the drag still follows pointermove.
    }
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!dragging.current || !rect) {
        return;
      }
      const next = sizeFromPointer(edge, { x: event.clientX, y: event.clientY }, rect);
      setSize(clampSize(next, limitsFor(edge, rect.height)));
    },
    [containerRef, edge]
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLElement>) => {
    dragging.current = false;
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // The pointer was already released.
    }
  }, []);

  const endDrag = useCallback(() => {
    dragging.current = false;
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const delta = keyboardDelta(edge, event.key);
      if (delta !== 0) {
        event.preventDefault();
        setSize(clampSize(current + delta, limits));
      }
    },
    [current, edge, limits]
  );

  const toggle = useCallback(() => setCollapsed((value) => !value), []);

  return {
    size: current,
    collapsed,
    toggle,
    separator: {
      orientation: edge === 'bottom' ? 'horizontal' : 'vertical',
      value: current,
      min: limits.min,
      max: limits.max,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onLostPointerCapture: endDrag,
      onKeyDown,
      onDoubleClick: () => setCollapsed(true),
    },
  };
}
