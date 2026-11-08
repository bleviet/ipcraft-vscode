import { useCallback, useRef, useState } from 'react';
import {
  DEFAULT_EXPORT_OPTIONS,
  type ExportImageOptions,
} from '../../../shared/messages/imageExport';
import { vscode } from '../../vscode';
import type { VisibleRectReader } from './useCanvasVisibleRect';

/**
 * State of the IP core editor's Export image button: the options (remembered by the host), the
 * request to open the popover, and the send, which adds the canvas's visible rectangle for the
 * Current view area. Exporting never changes the view.
 */
export function useIpCoreExport() {
  const [options, setOptions] = useState<ExportImageOptions>(DEFAULT_EXPORT_OPTIONS);
  const [openToken, setOpenToken] = useState(0);
  const visibleRectRef = useRef<VisibleRectReader | null>(null);

  const requestOpen = useCallback(() => setOpenToken((token) => token + 1), []);
  const exportImage = useCallback((chosen: ExportImageOptions) => {
    const visible = chosen.area === 'view' ? visibleRectRef.current?.() : null;
    vscode?.postMessage({
      type: 'exportImage',
      options: chosen,
      view: visible ? { visibleRect: visible.rect, bundlesExpanded: visible.bundlesExpanded } : {},
    });
  }, []);

  return { options, setOptions, openToken, requestOpen, exportImage, visibleRectRef };
}
