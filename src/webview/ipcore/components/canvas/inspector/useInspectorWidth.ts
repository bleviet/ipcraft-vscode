import { useCallback, useRef, useState } from 'react';

const INSPECTOR_WIDTH_KEY = 'ipcraft.inspectorWidth';
const INSPECTOR_MIN_WIDTH = 240;
const INSPECTOR_MAX_WIDTH = 640;
const INSPECTOR_DEFAULT_WIDTH = 288;

function readStoredWidth(): number {
  try {
    const stored = sessionStorage.getItem(INSPECTOR_WIDTH_KEY);
    if (stored) {
      const width = parseInt(stored, 10);
      if (width >= INSPECTOR_MIN_WIDTH && width <= INSPECTOR_MAX_WIDTH) {
        return width;
      }
    }
  } catch {
    // sessionStorage may be unavailable in some webview contexts
  }
  return INSPECTOR_DEFAULT_WIDTH;
}

export function useInspectorWidth(): {
  panelWidth: number;
  handleResizeMouseDown: (event: React.MouseEvent) => void;
} {
  const [panelWidth, setPanelWidth] = useState(readStoredWidth);
  const panelWidthRef = useRef(panelWidth);

  const handleResizeMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panelWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.max(
        INSPECTOR_MIN_WIDTH,
        Math.min(INSPECTOR_MAX_WIDTH, startWidth + delta)
      );
      panelWidthRef.current = newWidth;
      setPanelWidth(newWidth);
    };

    const onMouseUp = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try {
        sessionStorage.setItem(INSPECTOR_WIDTH_KEY, String(panelWidthRef.current));
      } catch {
        // sessionStorage may be unavailable in some webview contexts
      }
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  return { panelWidth, handleResizeMouseDown };
}
