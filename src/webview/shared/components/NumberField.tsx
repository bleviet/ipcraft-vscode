import React from 'react';
import { VSCodeTextField } from '@vscode/webview-ui-toolkit/react';

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
 * Uses VSCode Web UI Toolkit for native VS Code look and feel
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
  const handleChange = (newValue: string) => {
    const num = parseInt(newValue, 10);
    if (!isNaN(num)) {
      onChange(num);
    } else if (newValue === '') {
      onChange(0);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleKeyDown = (e: any) => {
    const event = e as unknown as KeyboardEvent;
    if (event.key === 'Enter') {
      onSave?.();
    } else if (event.key === 'Escape') {
      onCancel?.();
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-semibold flex items-center gap-1">
          {label}
          {required && <span style={{ color: 'var(--vscode-errorForeground)' }}>*</span>}
        </label>
      )}
      <VSCodeTextField
        data-edit-key={dataEditKey}
        className={className}
        value={String(value)}
        disabled={disabled}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onInput={(e: any) => {
          const event = e as unknown as React.ChangeEvent<HTMLInputElement>;
          handleChange(event.target.value ?? '');
        }}
        onKeyDown={handleKeyDown}
        style={
          {
            '--input-border-color': error ? 'var(--vscode-inputValidation-errorBorder)' : undefined,
          } as React.CSSProperties
        }
      />
      {error && (
        <span className="text-xs" style={{ color: 'var(--vscode-errorForeground)' }}>
          {error}
        </span>
      )}
    </div>
  );
};
