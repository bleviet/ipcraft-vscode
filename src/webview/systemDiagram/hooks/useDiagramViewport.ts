import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { diagramBounds } from '../layout/diagramBounds';
import { decideViewportAction, type Viewport } from '../layout/viewportPolicy';
import type { DiagramLayout } from './useElkLayout';

const FIT_PADDING = 0.1;

/**
 * Owns the React Flow viewport. Each level keeps its own zoom and pan in
 * memory: the first visit fits the whole diagram (badges included), returning
 * restores the saved viewport, and a new layout of the same level changes
 * nothing. The returned function fits the current level (Fit button); it also
 * runs when `resizeKey` changes (a panel was shown or hidden), once the canvas
 * has its new size. Must run inside a React Flow provider.
 */
export function useDiagramViewport(layout: DiagramLayout | null, resizeKey: string): () => void {
  const { fitBounds, getViewport, setViewport } = useReactFlow();
  const bounds = useMemo(() => (layout ? diagramBounds(layout) : null), [layout]);
  const saved = useRef(new Map<string, Viewport>());
  const shownLevel = useRef<string | null>(null);

  const fit = useCallback(() => {
    if (bounds) {
      void fitBounds(bounds, { padding: FIT_PADDING });
    }
  }, [bounds, fitBounds]);
  const fitRef = useRef(fit);
  fitRef.current = fit;

  useEffect(() => {
    if (!layout) {
      return;
    }
    const left = shownLevel.current;
    if (left !== null && left !== layout.levelPath) {
      saved.current.set(left, getViewport());
    }
    const action = decideViewportAction(left, layout.levelPath, saved.current);
    shownLevel.current = layout.levelPath;
    if (action.kind === 'keep') {
      return;
    }
    // Wait a frame so React Flow has rendered the new nodes.
    window.requestAnimationFrame(() => {
      if (action.kind === 'restore') {
        void setViewport(action.viewport);
      } else {
        fitRef.current();
      }
    });
  }, [layout, getViewport, setViewport]);

  const previousKey = useRef(resizeKey);
  useEffect(() => {
    if (previousKey.current === resizeKey) {
      return;
    }
    previousKey.current = resizeKey;
    // React Flow measures the container in a ResizeObserver callback; wait two
    // frames so fitBounds sees the new canvas size.
    let inner = 0;
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => fitRef.current());
    });
    return () => {
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
  }, [resizeKey]);

  return fit;
}
