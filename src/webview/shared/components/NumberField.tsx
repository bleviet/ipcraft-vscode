import React from 'react';
import { useEditableDraft } from '../hooks/useEditableDraft';

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /** Additional data attribute for edit key (vim navigation) */
  'data-edit-key'?: string;
  /** Additional className for the text field */
  className?: string;
  onSave?: () => void;
  onCancel?: () => void;
}

/**
 * Numeric input field
 * Uses a native text input with a numeric keyboard hint. Keeping text semantics
 * preserves invalid drafts until the existing parser decides whether to commit.
 */
export const NumberField: React.FC<NumberFieldProps> = ({
  label,
  value,
  onChange,
  min: _min,
  max: _max,
  step: _step = 1,
  error,
  required = false,
  disabled = false,
  'data-edit-key': dataEditKey,
  className,
  onSave,
  onCancel,
}) => {
  const { draft, setDraft, markFocused, markBlurred } = useEditableDraft(String(value));
  const controlId = React.useId();
  const errorId = `${controlId}-error`;

  const handleChange = (newValue: string) => {
    setDraft(newValue);
    const num = parseInt(newValue, 10);
    if (!isNaN(num)) {
      onChange(num);
    } else if (newValue === '') {
      onChange(0);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      onSave?.();
    } else if (event.key === 'Escape') {
      onCancel?.();
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={controlId} className="text-sm font-semibold flex items-center gap-1">
          {label}
          {required && <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>}
        </label>
      )}
      <input
        id={controlId}
        type="text"
        inputMode="numeric"
        data-edit-key={dataEditKey}
        className={`vscode-control ${className ?? ''}`}
        value={draft}
        disabled={disabled}
        required={required}
        aria-label={label || dataEditKey}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onFocus={markFocused}
        onBlur={markBlurred}
        onChange={(event) => handleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        data-validation={error ? 'error' : undefined}
      />
      {error && (
        <span id={errorId} className="text-xs" style={{ color: 'var(--vscode-errorForeground)' }}>
          {error}
        </span>
      )}
    </div>
  );
};
