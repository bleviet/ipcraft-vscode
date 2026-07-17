import React, { useCallback, useRef, useState } from 'react';

export interface TwoPanelEditorLayoutProps {
  /** Header bar (use EditorHeader). */
  header: React.ReactNode;
  /** Visualizer component (e.g. BitFieldVisualizer, AddressMapVisualizer). */
  visualizer: React.ReactNode;
  /** Main table / editing area. */
  table: React.ReactNode;
  /** Fixed/absolute-positioned overlays: KeyboardShortcutsButton, context menus, etc. */
  footer?: React.ReactNode;
  layout: 'stacked' | 'side-by-side';
  /**
   * CSS class controlling the visualizer pane's default/min/max width in
   * side-by-side layout. Defaults to 'register-visualizer-pane' (340px) —
   * pass 'register-visualizer-pane-compact' (240px) for visualizers that
   * don't need as much room, e.g. BitFieldVisualizer's bit-index + value
   * column. Either way it's still user-resizable via the drag handle.
   */
  visualizerPaneClassName?: string;
}

const MIN_VIZ_WIDTH = 240;
const MIN_TABLE_WIDTH = 240;

/**
 * Shared two-panel layout shell used by all editors.
 *
 * Side-by-side: visualizer pane on the left, table on the right, with a drag
 * handle between them so the user can widen the visualizer (e.g. to read long
 * register/array names that would otherwise be clipped at the default width).
 * Stacked: visualizer above the table.
 */
export function TwoPanelEditorLayout({
  header,
  visualizer,
  table,
  footer,
  layout,
  visualizerPaneClassName = 'register-visualizer-pane',
}: TwoPanelEditorLayoutProps) {
  // null = use the CSS default width (.register-visualizer-pane); a number is
  // the user-driven pixel width.
  const [vizWidth, setVizWidth] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const onHandlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture?.(e.pointerId);
    } catch {
      // setPointerCapture not supported (e.g. jsdom) — drag still works via
      // pointermove/pointerup on the handle.
    }
  }, []);

  const onHandlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current || !containerRef.current) {
      return;
    }
    const rect = containerRef.current.getBoundingClientRect();
    const w = e.clientX - rect.left;
    const clamped = Math.min(Math.max(w, MIN_VIZ_WIDTH), rect.width - MIN_TABLE_WIDTH);
    setVizWidth(clamped);
  }, []);

  const onHandlePointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // pointerId already released
    }
  }, []);

  return (
    <div className="flex flex-col w-full h-full min-h-0">
      {header}

      {layout === 'side-by-side' ? (
        <div ref={containerRef} className="flex-1 flex overflow-hidden min-h-0 relative">
          <div
            className={`${visualizerPaneClassName} overflow-y-auto border-r vscode-border`}
            style={
              vizWidth
                ? { width: vizWidth, flex: '0 0 auto', maxWidth: 'none', minWidth: 0 }
                : undefined
            }
          >
            {visualizer}
          </div>
          <div
            className="panel-resize-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize visualizer pane"
            title="Drag to resize"
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
          />
          <div className="flex-1 vscode-surface min-h-0 flex flex-col overflow-hidden min-w-0">
            {table}
          </div>
        </div>
      ) : (
        <>
          <div className="vscode-surface border-b vscode-border p-8 flex flex-col gap-6 shrink-0 relative overflow-hidden">
            <div className="w-full relative z-10 mt-2 select-none">{visualizer}</div>
          </div>
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="flex-1 vscode-surface min-h-0 flex flex-col">{table}</div>
          </div>
        </>
      )}

      {footer}
    </div>
  );
}
