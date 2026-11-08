import { useEffect, type MutableRefObject, type RefObject } from 'react';
import type { ExportRect } from '../../../shared/messages/imageExport';
import { visibleLayoutRect, type Point } from '../components/canvas/canvasGeometry';

/** What the canvas shows now: the visible layout rectangle and whether a bus bundle is expanded; null while unmounted. */
export type VisibleRectReader = () => { rect: ExportRect; bundlesExpanded: boolean } | null;

/**
 * Keeps `readerRef` pointing at a reader of the canvas's visible layout rectangle, for the Export
 * image button, which lives outside the canvas. Reading it never touches the view.
 */
export function useCanvasVisibleRect(
  readerRef: MutableRefObject<VisibleRectReader | null> | undefined,
  containerRef: RefObject<HTMLDivElement | null>,
  viewBox: { width: number; height: number },
  pan: Point,
  zoom: number,
  bundlesExpanded: boolean
): void {
  useEffect(() => {
    if (!readerRef) {
      return;
    }
    readerRef.current = () => {
      const container = containerRef.current;
      if (!container || container.clientWidth === 0 || container.clientHeight === 0) {
        return null;
      }
      return {
        rect: visibleLayoutRect(
          viewBox,
          { width: container.clientWidth, height: container.clientHeight },
          pan,
          zoom
        ),
        bundlesExpanded,
      };
    };
    return () => {
      readerRef.current = null;
    };
  }, [readerRef, containerRef, viewBox, pan, zoom, bundlesExpanded]);
}
