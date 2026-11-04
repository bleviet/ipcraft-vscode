import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { diagramBounds } from '../layout/diagramBounds';
import { nodeCenter } from '../layout/nodeCenter';
import { decideViewportAction, type Viewport } from '../layout/viewportPolicy';
import type { RevealRequest } from '../model';
import type { DiagramLayout } from './useElkLayout';

const FIT_PADDING = 0.1;

/**
 * Owns the React Flow viewport. Each level keeps its own zoom and pan in
 * memory: the first visit fits the whole diagram (badges included), returning
 * restores the saved viewport, and a new layout of the same level changes
 * nothing. The returned function fits the current level (Fit button); it also
 * runs when `resizeKey` changes (a panel was shown or hidden), once the canvas
 * has its new size. A reveal request centres its node at the current zoom once
 * its level is shown (after the policy above applied). Must run inside a React Flow provider.
 */
export function useDiagramViewport(
  layout: DiagramLayout | null,
  resizeKey: string,
  revealRequest: RevealRequest | null
): () => void {
  const { fitBounds, getViewport, setViewport, setCenter } = useReactFlow();
  const bounds = useMemo(() => (layout ? diagramBounds(layout) : null), [layout]);
  const saved = useRef(new Map<string, Viewport>());
  const shownLevel = useRef<string | null>(null);
  const handledToken = useRef(0);

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
    const reveal =
      revealRequest &&
      revealRequest.token !== handledToken.current &&
      revealRequest.levelPath === layout.levelPath
        ? revealRequest
        : null;
    if (reveal) {
      handledToken.current = reveal.token;
    }
    if (action.kind === 'keep' && !reveal) {
      return;
    }
    const centre = () => {
      const target = reveal && nodeCenter(layout, reveal.selection.id);
      if (target) {
        void setCenter(target.x, target.y, { zoom: getViewport().zoom });
      }
    };
    // Wait a frame so React Flow has rendered the new nodes.
    window.requestAnimationFrame(() => {
      if (action.kind === 'keep') {
        centre();
        return;
      }
      if (action.kind === 'restore') {
        void setViewport(action.viewport);
      } else {
        fitRef.current();
      }
      // Centre after the viewport change so the resulting zoom is kept.
      window.requestAnimationFrame(centre);
    });
  }, [layout, revealRequest, getViewport, setViewport, setCenter]);

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
