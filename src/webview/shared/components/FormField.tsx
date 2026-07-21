import React from 'react';
import { useEditableDraft } from '../hooks/useEditableDraft';

export interface FormFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  validator?: (value: string) => string | null;
  onBlur?: () => void;
  /** Additional data attribute for edit key (vim navigation) */
  'data-edit-key'?: string;
  /** Additional className for the text field */
  className?: string;
  /** Callback for specific key actions */
  onSave?: () => void;
  onCancel?: () => void;
}

/**
 * Text input form field with validation
 * Uses a semantic native input styled with VS Code theme tokens.
 */
export const FormField: React.FC<FormFieldProps> = ({
  label,
  value,
  onChange,
  error,
  placeholder,
  required = false,
  disabled = false,
  validator,
  onBlur,
  'data-edit-key': dataEditKey,
  className,
  onSave,
  onCancel,
}) => {
  const [localError, setLocalError] = React.useState<string | null>(null);
  const controlId = React.useId();
  const errorId = `${controlId}-error`;
  const { draft, setDraft, markFocused, markBlurred } = useEditableDraft(value);

  const handleBlur = () => {
    markBlurred();
    if (validator) {
      const validationError = validator(value);
      setLocalError(validationError);
    }
    onBlur?.();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      // For text fields, Enter usually means save.
      onSave?.();
    } else if (event.key === 'Escape') {
      onCancel?.();
    }
  };

  const displayError = error ?? localError;

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
        data-edit-key={dataEditKey}
        className={`vscode-control ${className ?? ''}`}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-label={label || dataEditKey}
        aria-invalid={displayError ? true : undefined}
        aria-describedby={displayError ? errorId : undefined}
        onFocus={markFocused}
        onChange={(event) => {
          const newValue = event.target.value;
          setDraft(newValue);
          onChange(newValue);
          if (localError && validator) {
            const validationError = validator(newValue);
            setLocalError(validationError);
          }
        }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        data-validation={displayError ? 'error' : undefined}
      />
      {displayError && (
        <span id={errorId} className="text-xs" style={{ color: 'var(--vscode-errorForeground)' }}>
          {displayError}
        </span>
      )}
    </div>
  );
};
