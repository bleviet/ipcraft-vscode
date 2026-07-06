import React from 'react';
import { useDebugMode } from '../../hooks/useDebugMode';

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
 * Renders title, description, the stacked/side-by-side toggle button, and the
 * document-wide Debug Mode toggle (see useDebugMode).
 */
export function EditorHeader({
  title,
  description,
  layout,
  onToggleLayout,
  children,
}: EditorHeaderProps) {
  const { debugMode, toggleDebugMode } = useDebugMode();

  return (
    <div className="vscode-surface border-b vscode-border px-6 py-2 shrink-0">
      <div className="flex justify-between items-start gap-4">
        <div>
          <h2 className="text-xl font-bold font-mono tracking-tight">{title}</h2>
          {description !== null && description !== undefined && (
            <p className="vscode-muted text-xs mt-0.5 max-w-2xl">{description}</p>
          )}
          {debugMode && (
            <div
              className="inline-flex items-center gap-1.5 mt-1.5 px-2 py-0.5 rounded text-[11px]"
              style={{
                background: 'var(--vscode-inputValidation-warningBackground)',
                border: '1px solid var(--vscode-inputValidation-warningBorder)',
                color: 'var(--vscode-foreground)',
              }}
            >
              <span className="codicon codicon-debug-alt" style={{ fontSize: '12px' }} />
              Debug Mode — register value changes are not saved
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            className={`p-2 rounded-md transition-colors vscode-icon-button${
              debugMode ? ' vscode-icon-button-active' : ''
            }`}
            onClick={toggleDebugMode}
            title={
              debugMode
                ? 'Disable Debug Mode (register value changes will be saved again)'
                : 'Enable Debug Mode (explore register values without saving changes)'
            }
            aria-label="Toggle Debug Mode"
            aria-pressed={debugMode}
            type="button"
          >
            <span className="codicon codicon-debug-alt" />
          </button>
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
      </div>
      {children}
    </div>
  );
}
