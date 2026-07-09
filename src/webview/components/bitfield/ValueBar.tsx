import React from 'react';
import { VSCodeTextField } from '@vscode/webview-ui-toolkit/react';

interface ValueBarProps {
  valueDraft: string;
  valueError: string | null;
  valueView: 'hex' | 'dec';
  setValueDraft: (value: string) => void;
  setValueEditing: (editing: boolean) => void;
  setValueError: (value: string | null) => void;
  setValueView: (updater: (view: 'hex' | 'dec') => 'hex' | 'dec') => void;
  parseRegisterValue: (text: string, view: 'hex' | 'dec') => number | null;
  validateRegisterValue: (value: number | null) => string | null;
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
  return (
    <div
      className="mt-3 flex items-center justify-start gap-3 p-3 rounded"
      style={{ background: 'var(--vscode-editor-background)' }}
    >
      <div className="text-sm vscode-muted font-mono font-semibold">Value:</div>
      <div className="min-w-[160px] text-base">
        <div
          className="flex items-stretch rounded"
          style={{
            border: '1px solid var(--vscode-dropdown-border, var(--vscode-panel-border))',
            background: 'var(--vscode-input-background)',
          }}
        >
          {valueView === 'hex' ? (
            <span
              className="flex items-center pl-2 font-mono select-none"
              style={{
                fontSize: 'var(--vscode-font-size, 13px)',
                color: 'var(--vscode-input-foreground)',
              }}
              aria-hidden="true"
            >
              0x
            </span>
          ) : null}
          <VSCodeTextField
            className="vscode-field-bare flex-1 font-mono"
            value={valueDraft}
            onFocus={(event) => {
              setValueEditing(true);
              (event.target as HTMLInputElement).select?.();
            }}
            onBlur={() => {
              setValueEditing(false);
              commitRegisterValueDraft();
            }}
            onInput={(event) => {
              const next = String((event.target as HTMLInputElement).value ?? '');
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
        {valueError ? <div className="text-xs vscode-error mt-1">{valueError}</div> : null}
      </div>
      <button
        type="button"
        className="px-3 py-2 text-sm font-semibold border rounded"
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
