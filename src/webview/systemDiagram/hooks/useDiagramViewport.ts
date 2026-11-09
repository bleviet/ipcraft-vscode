import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { getViewportForBounds, useReactFlow, useStoreApi } from '@xyflow/react';
import { diagramBounds, nodeBounds } from '../layout/diagramBounds';
import { nodeCenter } from '../layout/nodeCenter';
import { revealZoom } from '../layout/revealZoom';
import {
  anchoredViewport,
  decideViewportAction,
  toggledNodeId,
  withSavedViewport,
  type Viewport,
} from '../layout/viewportPolicy';
import type { RevealRequest } from '../model';
import type { DiagramLayout } from './useElkLayout';

const FIT_PADDING = 0.1;
const FOCUS_PADDING = 0.25;

export interface DiagramViewport {
  fit: () => void;
  focusNode: (nodeId: string) => void;
}

/**
 * Owns the React Flow viewport. Each level keeps its own zoom and pan in
 * memory: the first visit fits the whole diagram (badges included), returning
 * restores the saved viewport, and a new layout of the same level changes
 * nothing. An isolated view (see `viewKey`) is never saved: each new isolation
 * fits, and leaving it restores the level's viewport from before. `fit` fits
 * the current level (Fit button); it also runs when `resizeKey` changes (a
 * panel was shown or hidden), once the canvas has its new size. A reveal
 * request centres its node at the current zoom (a readable one for search
 * steps: see `revealZoom`) once its level is shown (after the policy above
 * applied) and its node is in the layout; until then it waits, for example
 * while an isolated layout that hides the node is still displayed.
 * `focusNode` zooms to one node of the current level, badges included
 * (double-click). A hierarchy block expanded or collapsed in place stays at the
 * same screen point: the pan follows its new position. Must run inside a React
 * Flow provider.
 */
export function useDiagramViewport(
  layout: DiagramLayout | null,
  resizeKey: string,
  revealRequest: RevealRequest | null
): DiagramViewport {
  const { fitBounds, getViewport, setViewport, setCenter } = useReactFlow();
  const store = useStoreApi();
  const bounds = useMemo(() => (layout ? diagramBounds(layout) : null), [layout]);
  const saved = useRef<ReadonlyMap<string, Viewport>>(new Map());
  const shownKey = useRef<string | null>(null);
  const handledToken = useRef(0);
  const shownLayout = useRef<DiagramLayout | null>(null);

  const fit = useCallback(() => {
    if (bounds) {
      void fitBounds(bounds, { padding: FIT_PADDING });
    }
  }, [bounds, fitBounds]);
  const focusNode = useCallback(
    (nodeId: string) => {
      const node = layout?.nodes.find((candidate) => candidate.id === nodeId);
      if (node) {
        void fitBounds(nodeBounds(node), { padding: FOCUS_PADDING });
      }
    },
    [layout, fitBounds]
  );
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // A layout effect, so the frame that shows the new layout already has the corrected pan.
  useLayoutEffect(() => {
    const left = shownKey.current;
    const previousLayout = shownLayout.current;
    shownLayout.current = layout;
    if (!layout) {
      // The layout is unavailable (error). React Flow stays mounted, so the
      // view survives; save it so the recovered layout restores it even if the
      // user pans the empty canvas meanwhile.
      saved.current = withSavedViewport(saved.current, left, getViewport());
      shownKey.current = null;
      return;
    }
    if (left !== layout.viewKey) {
      saved.current = withSavedViewport(saved.current, left, getViewport());
    }
    const action = decideViewportAction(left, layout.viewKey, saved.current);
    shownKey.current = layout.viewKey;
    const reveal =
      revealRequest &&
      revealRequest.token !== handledToken.current &&
      revealRequest.levelPath === layout.levelPath &&
      nodeCenter(layout, revealRequest.selection.id)
        ? revealRequest
        : null;
    if (reveal) {
      handledToken.current = reveal.token;
    }
    if (action.kind === 'keep' && !reveal) {
      const toggled =
        previousLayout && previousLayout !== layout
          ? toggledNodeId(previousLayout.nodes, layout.nodes)
          : undefined;
      if (!previousLayout || toggled === undefined) {
        return;
      }
      const before = previousLayout.nodes.find((node) => node.id === toggled);
      const after = layout.nodes.find((node) => node.id === toggled);
      if (before && after) {
        void setViewport(anchoredViewport(getViewport(), before.position, after.position));
      }
      return;
    }
    const centre = () => {
      const target = reveal && nodeCenter(layout, reveal.selection.id);
      if (!reveal || !target) {
        return;
      }
      let zoom = getViewport().zoom;
      const node = reveal.readable && layout.nodes.find((n) => n.id === reveal.selection.id);
      if (node) {
        const { width, height, minZoom, maxZoom } = store.getState();
        const fit = getViewportForBounds(
          nodeBounds(node),
          width,
          height,
          minZoom,
          maxZoom,
          FOCUS_PADDING
        );
        zoom = revealZoom(zoom, fit.zoom);
      }
      void setCenter(target.x, target.y, { zoom });
    };
    // These paths read the layout and the canvas size, not React Flow's node
    // store; the frame lets the canvas commit before the viewport moves.
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
  }, [layout, revealRequest, getViewport, setViewport, setCenter, store]);

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

  return { fit, focusNode };
}
