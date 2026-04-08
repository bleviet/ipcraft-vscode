import React, { useRef, useState } from 'react';
import { VSCodeTextField, VSCodeDropdown, VSCodeOption } from '@vscode/webview-ui-toolkit/react';

const NUMERIC_PARAM_TYPES = new Set(['integer', 'natural', 'positive']);

export interface WidthParameter {
  name: string;
  dataType?: string;
}

export interface WidthFieldProps {
  /** Current width — either a positive integer or a parameter name */
  value: number | string;
  onChange: (value: number | string) => void;
  onSave?: () => void;
  onCancel?: () => void;
  /**
   * Called with the committed value directly — avoids stale-closure issues
   * when the caller needs to act on the new value immediately (e.g. on
   * dropdown selection or blur).  If provided it is called INSTEAD of
   * `onSave`.
   */
  onSaveWithValue?: (value: number | string) => void;
  /** Available parameters to offer as width references */
  parameters?: WidthParameter[];
  /** The library default width, used when reverting from param mode to number mode */
  defaultWidth?: number;
  label?: string;
  disabled?: boolean;
  /** Additional className for the wrapper */
  className?: string;
}

/**
 * Dual-mode width input — either a plain positive integer or a reference to an
 * integer/natural/positive parameter defined on the IP core.
 *
 * A small toggle button lets the user switch between the two modes.  When
 * switching from parameter mode back to number mode the field is initialised
 * to `defaultWidth ?? 1`.
 *
 * Saves are committed:
 * - On Enter key (number mode)
 * - On blur when focus leaves the whole component (number mode panel-switch)
 * - Immediately on dropdown selection (param mode — no pending draft)
 */
export const WidthField: React.FC<WidthFieldProps> = ({
  value,
  onChange,
  onSave,
  onCancel,
  onSaveWithValue,
  parameters = [],
  defaultWidth = 1,
  label,
  disabled = false,
  className,
}) => {
  const numericParams = parameters.filter(
    (p) => !p.dataType || NUMERIC_PARAM_TYPES.has(p.dataType.toLowerCase())
  );

  const [isParamMode, setIsParamMode] = useState(() => typeof value === 'string');

  // Track the latest text input value in a ref so onBlur can read it
  // synchronously without relying on potentially-stale React state.
  const textValueRef = useRef<string>(
    typeof value === 'number' ? String(value) : String(defaultWidth)
  );

  const commit = (v: number | string) => {
    if (onSaveWithValue) {
      onSaveWithValue(v);
    } else {
      onSave?.();
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleKeyDown = (e: any) => {
    const event = e as unknown as KeyboardEvent;
    if (event.key === 'Enter') {
      const num = parseInt(textValueRef.current, 10);
      commit(!isNaN(num) && num > 0 ? num : defaultWidth);
    } else if (event.key === 'Escape') {
      onCancel?.();
    }
  };

  /** Save when focus leaves the entire WidthField (handles panel switches). */
  const handleBlur = (e: React.FocusEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      if (!isParamMode) {
        const num = parseInt(textValueRef.current, 10);
        commit(!isNaN(num) && num > 0 ? num : defaultWidth);
      }
      // Param mode is saved immediately on selection — no action needed here.
    }
  };

  const toggleMode = () => {
    if (isParamMode) {
      setIsParamMode(false);
      onChange(defaultWidth);
    } else {
      setIsParamMode(true);
      if (numericParams.length > 0) {
        onChange(numericParams[0].name);
      }
    }
  };

  const modeTitle = isParamMode
    ? 'Switch to literal number'
    : numericParams.length === 0
      ? 'No integer parameters defined'
      : 'Use a parameter as width';

  return (
    <div className={`flex flex-col gap-1 ${className ?? ''}`} onBlur={handleBlur}>
      {label && <label className="text-sm font-semibold">{label}</label>}

      <div className="flex items-center gap-1">
        {isParamMode ? (
          numericParams.length === 0 ? (
            <span
              className="text-xs italic"
              style={{ color: 'var(--vscode-descriptionForeground)' }}
            >
              No integer parameters defined
            </span>
          ) : (
            <VSCodeDropdown
              value={typeof value === 'string' ? value : (numericParams[0]?.name ?? '')}
              disabled={disabled}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onChange={(e: any) => {
                const ev = e as unknown as React.ChangeEvent<HTMLSelectElement>;
                const selected = ev.target.value ?? '';
                onChange(selected);
                // Commit immediately — selecting from a dropdown is a definitive
                // action and we must not rely on onBlur (shadow DOM uncertainty).
                commit(selected);
              }}
              style={{ flexGrow: 1 }}
            >
              {numericParams.map((p) => (
                <VSCodeOption key={p.name} value={p.name}>
                  {p.name}
                </VSCodeOption>
              ))}
            </VSCodeDropdown>
          )
        ) : (
          <VSCodeTextField
            value={typeof value === 'number' ? String(value) : String(defaultWidth)}
            disabled={disabled}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onInput={(e: any) => {
              const ev = e as unknown as React.ChangeEvent<HTMLInputElement>;
              const raw = ev.target.value ?? '';
              textValueRef.current = raw;
              const num = parseInt(raw, 10);
              if (!isNaN(num) && num > 0) {
                onChange(num);
              }
            }}
            onKeyDown={handleKeyDown}
            style={{ flexGrow: 1 }}
          />
        )}

        <button
          type="button"
          title={modeTitle}
          onClick={toggleMode}
          // Prevent focus from leaving the text field when clicking this button.
          // Without this, VSCodeTextField's shadow-DOM blur fires with relatedTarget=null,
          // which looks like focus leaving the component and incorrectly triggers a commit.
          onMouseDown={(e) => e.preventDefault()}
          disabled={disabled || (!isParamMode && numericParams.length === 0)}
          className="shrink-0 rounded px-1.5 py-0.5 text-xs font-mono transition-opacity"
          style={{
            background: isParamMode
              ? 'var(--vscode-button-background)'
              : 'var(--vscode-button-secondaryBackground)',
            color: isParamMode
              ? 'var(--vscode-button-foreground)'
              : 'var(--vscode-button-secondaryForeground)',
            border: '1px solid var(--vscode-button-border, transparent)',
            cursor: !isParamMode && numericParams.length === 0 ? 'not-allowed' : 'pointer',
            opacity: !isParamMode && numericParams.length === 0 ? 0.4 : 1,
          }}
        >
          {isParamMode ? '123' : 'P'}
        </button>
      </div>
    </div>
  );
};
