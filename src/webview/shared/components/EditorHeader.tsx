import React from 'react';

export interface EditorHeaderProps {
  title: string;
  description?: string | React.ReactNode;
  layout: 'stacked' | 'side-by-side';
  onToggleLayout: () => void;
  /** Optional slot for extra content below the title row (e.g. a properties grid). */
  children?: React.ReactNode;
}

/**
 * Shared header bar used by all editors.
 * Renders title, description, and the stacked/side-by-side toggle button.
 */
export function EditorHeader({
  title,
  description,
  layout,
  onToggleLayout,
  children,
}: EditorHeaderProps) {
  return (
    <div className="vscode-surface border-b vscode-border px-6 py-2 shrink-0">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h2 className="text-xl font-bold font-mono tracking-tight">{title}</h2>
          {description !== null && description !== undefined && (
            <p className="vscode-muted text-xs mt-0.5 max-w-2xl">{description}</p>
          )}
        </div>
        <button
          className="p-2 rounded-md transition-colors vscode-icon-button"
          onClick={onToggleLayout}
          title={
            layout === 'stacked' ? 'Switch to side-by-side layout' : 'Switch to stacked layout'
          }
          aria-label="Toggle layout"
          type="button"
        >
          <span
            className={`codicon ${
              layout === 'stacked' ? 'codicon-split-horizontal' : 'codicon-split-vertical'
            }`}
          />
        </button>
      </div>
      {children}
    </div>
  );
}
