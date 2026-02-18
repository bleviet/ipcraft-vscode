import React from 'react';
import { VSCodeDropdown, VSCodeOption } from '@vscode/webview-ui-toolkit/react';

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
 * Uses VSCode Web UI Toolkit for native VS Code look and feel
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
  const handleKeyDown = (e: any) => {
    if (e.key === 'Enter') {
      onSave?.();
    } else if (e.key === 'Escape') {
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
      <VSCodeDropdown
        data-edit-key={dataEditKey}
        className={className}
        value={value}
        disabled={disabled}
        onChange={(e: any) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        style={
          {
            '--dropdown-border': error
              ? '1px solid var(--vscode-inputValidation-errorBorder)'
              : undefined,
          } as React.CSSProperties
        }
      >
        {options.map((option) => (
          <VSCodeOption key={option.value} value={option.value}>
            {option.label}
          </VSCodeOption>
        ))}
      </VSCodeDropdown>
      {error && (
        <span className="text-xs" style={{ color: 'var(--vscode-errorForeground)' }}>
          {error}
        </span>
      )}
    </div>
  );
};
