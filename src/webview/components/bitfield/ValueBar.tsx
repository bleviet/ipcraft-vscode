import React from 'react';
import type { RegisterValueParse } from './utils';

interface ValueBarProps {
  valueDraft: string;
  valueError: string | null;
  valueView: 'hex' | 'dec';
  setValueDraft: (value: string) => void;
  setValueEditing: (editing: boolean) => void;
  setValueError: (value: string | null) => void;
  setValueView: (updater: (view: 'hex' | 'dec') => 'hex' | 'dec') => void;
  parseRegisterValue: (text: string, view: 'hex' | 'dec') => RegisterValueParse;
  validateRegisterValue: (value: RegisterValueParse) => string | null;
  commitRegisterValueDraft: () => void;
}

const ValueBar = ({
  valueDraft,
  valueError,
  valueView,
  setValueDraft,
  setValueEditing,
  setValueError,
  setValueView,
  parseRegisterValue,
  validateRegisterValue,
  commitRegisterValueDraft,
}: ValueBarProps) => {
  const errorId = React.useId();
  return (
    <div
      className="flex items-center justify-start gap-2 p-2 rounded"
      style={{ background: 'var(--vscode-editor-background)' }}
    >
      <div className="text-xs vscode-muted font-mono font-semibold shrink-0">Value:</div>
      <div className="flex-1 min-w-[70px] text-base">
        <div
          className="flex items-stretch rounded"
          style={{
            border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
            background: 'var(--vscode-input-background)',
          }}
        >
          {valueView === 'hex' ? (
            <span
              className="flex items-center pl-1.5 font-mono select-none"
              style={{
                fontSize: 'var(--vscode-font-size, 13px)',
                color: 'var(--vscode-input-foreground)',
              }}
              aria-hidden="true"
            >
              0x
            </span>
          ) : null}
          <input
            type="text"
            aria-label={`Register value (${valueView})`}
            aria-invalid={valueError ? true : undefined}
            aria-describedby={valueError ? errorId : undefined}
            className="vscode-control vscode-field-bare flex-1 min-w-0 font-mono"
            value={valueDraft}
            onFocus={(event) => {
              setValueEditing(true);
              (event.target as HTMLInputElement).select?.();
            }}
            onBlur={() => {
              setValueEditing(false);
              commitRegisterValueDraft();
            }}
            onChange={(event) => {
              const next = event.target.value;
              setValueDraft(next);
              const parsed = parseRegisterValue(next, valueView);
              setValueError(validateRegisterValue(parsed));
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') {
                return;
              }
              event.preventDefault();
              event.stopPropagation();
              commitRegisterValueDraft();
              setValueEditing(false);
              (event.currentTarget as HTMLElement | null)?.blur?.();
            }}
          />
        </div>
        {valueError ? (
          <div id={errorId} className="text-xs vscode-error mt-1">
            {valueError}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="shrink-0 px-2 py-1 text-xs font-semibold border rounded"
        style={{
          borderColor: 'var(--vscode-button-border, var(--vscode-panel-border))',
          background: 'var(--vscode-button-background)',
          color: 'var(--vscode-button-foreground)',
        }}
        onMouseEnter={(event) => {
          (event.currentTarget as HTMLButtonElement).style.background =
            'var(--vscode-button-hoverBackground)';
        }}
        onMouseLeave={(event) => {
          (event.currentTarget as HTMLButtonElement).style.background =
            'var(--vscode-button-background)';
        }}
        onClick={() => setValueView((view) => (view === 'hex' ? 'dec' : 'hex'))}
        title="Toggle hex/dec"
      >
        {valueView.toUpperCase()}
      </button>
    </div>
  );
};

export default ValueBar;
