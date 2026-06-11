import React from 'react';

export interface TwoPanelEditorLayoutProps {
  /** Header bar (use EditorHeader). */
  header: React.ReactNode;
  /** Visualizer component (BitFieldVisualizer, RegisterMapVisualizer, etc.). */
  visualizer: React.ReactNode;
  /** Main table / editing area. */
  table: React.ReactNode;
  /** Fixed/absolute-position overlays: KeyboardShortcutsButton, context menus, etc. */
  footer?: React.ReactNode;
  layout: 'stacked' | 'side-by-side';
}

/**
 * Shared two-panel layout shell used by all editors.
 *
 * Side-by-side: visualizer pane on the left, table on the right.
 * Stacked: visualizer above the table.
 */
export function TwoPanelEditorLayout({
  header,
  visualizer,
  table,
  footer,
  layout,
}: TwoPanelEditorLayoutProps) {
  return (
    <div className="flex flex-col w-full h-full min-h-0">
      {header}

      {layout === 'side-by-side' ? (
        <div className="flex-1 flex overflow-hidden min-h-0">
          <div className="register-visualizer-pane shrink-0 overflow-y-auto border-r vscode-border">
            {visualizer}
          </div>
          <div className="flex-1 vscode-surface min-h-0 flex flex-col overflow-hidden">{table}</div>
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
