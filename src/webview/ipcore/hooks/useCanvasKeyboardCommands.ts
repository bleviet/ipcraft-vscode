import { useEffect } from 'react';

/**
 * Canvas-level keyboard shortcuts: Ctrl/Cmd+F opens port search, Escape closes
 * the search bar (or exits select mode), Ctrl/Cmd+0 resets zoom & pan.
 * Extracted from IpBlockCanvas (issue #129).
 *
 * Ctrl+F is intentionally the only shortcut that fires while an input/textarea
 * is focused — every other canvas shortcut must respect the typing-target guard.
 */
export function useCanvasKeyboardCommands(opts: {
  showSearch: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  exitSelectMode: () => void;
  resetView: () => void;
}) {
  const { showSearch, openSearch, closeSearch, exitSelectMode, resetView } = opts;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd+F: open port search (allow even when an input is focused)
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        openSearch();
        return;
      }

      // Don't trigger other shortcuts if user is typing in an input or textarea
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') {
        if (e.key === 'Escape') {
          // Close search bar when Escape is pressed inside the search input
          closeSearch();
          (document.activeElement as HTMLElement).blur();
        }
        return;
      }

      if (e.key === 'Escape') {
        if (showSearch) {
          closeSearch();
        } else {
          exitSelectMode();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        resetView();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showSearch, openSearch, closeSearch, exitSelectMode, resetView]);
}
