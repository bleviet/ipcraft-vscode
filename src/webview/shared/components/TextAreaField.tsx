import React from 'react';
import { VSCodeTextArea } from '@vscode/webview-ui-toolkit/react';

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
 * Uses VSCode Web UI Toolkit for native VS Code look and feel
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
  const handleKeyDown = (e: any) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
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
      <VSCodeTextArea
        data-edit-key={dataEditKey}
        className={className}
        value={value}
        rows={rows}
        placeholder={placeholder}
        disabled={disabled}
        onInput={(e: any) => onChange(e.target.value ?? '')}
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
