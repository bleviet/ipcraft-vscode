import React from 'react';

export interface SelectFieldProps {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  /** Additional data attribute for edit key (vim navigation) */
  'data-edit-key'?: string;
  /** Additional className for the dropdown */
  className?: string;
  onSave?: () => void;
  onCancel?: () => void;
}

/**
 * Dropdown select field
 * Uses a semantic native select styled with VS Code theme tokens.
 */
export const SelectField: React.FC<SelectFieldProps> = ({
  label,
  value,
  options,
  onChange,
  error,
  required = false,
  disabled = false,
  'data-edit-key': dataEditKey,
  className,
  onSave,
  onCancel,
}) => {
  const controlId = React.useId();
  const errorId = `${controlId}-error`;
  const handleKeyDown = (event: React.KeyboardEvent<HTMLSelectElement>) => {
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
      <select
        id={controlId}
        data-edit-key={dataEditKey}
        className={`vscode-control vscode-select ${className ?? ''}`}
        value={value}
        disabled={disabled}
        required={required}
        aria-label={label || dataEditKey}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        data-validation={error ? 'error' : undefined}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && (
        <span id={errorId} className="text-xs" style={{ color: 'var(--vscode-errorForeground)' }}>
          {error}
        </span>
      )}
    </div>
  );
};
