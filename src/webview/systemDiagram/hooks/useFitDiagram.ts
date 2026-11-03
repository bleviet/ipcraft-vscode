import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useReactFlow } from '@xyflow/react';
import { diagramBounds } from '../layout/diagramBounds';
import type { DiagramLayout } from './useElkLayout';

const FIT_PADDING = 0.1;

/**
 * Fits the viewport to the whole diagram, badges included. Fits after each new
 * layout and again when `resizeKey` changes (a panel was shown or hidden), once
 * the canvas has its new size. Must run inside a React Flow provider.
 */
export function useFitDiagram(layout: DiagramLayout | null, resizeKey: string): () => void {
  const { fitBounds } = useReactFlow();
  const bounds = useMemo(() => (layout ? diagramBounds(layout) : null), [layout]);

  const fit = useCallback(() => {
    if (bounds) {
      void fitBounds(bounds, { padding: FIT_PADDING });
    }
  }, [bounds, fitBounds]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(fit);
    return () => window.cancelAnimationFrame(frame);
  }, [fit]);

  const fitRef = useRef(fit);
  fitRef.current = fit;
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
