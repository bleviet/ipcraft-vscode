import React from 'react';
import { useEditableDraft } from '../hooks/useEditableDraft';

export interface TextAreaFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /** Additional data attribute for edit key (vim navigation) */
  'data-edit-key'?: string;
  /** Additional className for the text area */
  className?: string;
  onSave?: () => void;
  onCancel?: () => void;
}

/**
 * Multi-line text area field
 * Uses a semantic native textarea styled with VS Code theme tokens.
 */
export const TextAreaField: React.FC<TextAreaFieldProps> = ({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
  error,
  required = false,
  disabled = false,
  'data-edit-key': dataEditKey,
  className,
  onSave,
  onCancel,
}) => {
  const { draft, setDraft, markFocused, markBlurred } = useEditableDraft(value);
  const controlId = React.useId();
  const errorId = `${controlId}-error`;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
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
      <textarea
        id={controlId}
        data-edit-key={dataEditKey}
        className={`vscode-control ${className ?? ''}`}
        value={draft}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-label={label || dataEditKey}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onFocus={markFocused}
        onBlur={markBlurred}
        onChange={(event) => {
          const newValue = event.target.value;
          setDraft(newValue);
          onChange(newValue);
        }}
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
