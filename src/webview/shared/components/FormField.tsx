import React from 'react';
import { VSCodeTextField } from '@vscode/webview-ui-toolkit/react';

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
 * Uses VSCode Web UI Toolkit for native VS Code look and feel
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

  const handleBlur = () => {
    if (validator) {
      const validationError = validator(value);
      setLocalError(validationError);
    }
    onBlur?.();
  };

  const handleKeyDown = (e: any) => {
    // VSCodeTextField uses CustomEvent-like synthetic events but we can access original event
    // Note: The VS Code Webview UI Toolkit components wrap native inputs.
    // The event passed to onKeyDown might be the native keyboard event directly if attached to the web component?
    // Actually for React wrapper, let's try standard React KeyboardEvent but typing might be tricky.
    // It seems VSCodeTextField doesn't expose onKeyDown directly in standard React props interface efficiently
    // unless we cast it or it just bubbles. Let's assume standard bubbling works on the wrapper div or we attach to component.
    // However, the toolkit components often stop propagation?
    // Let's attach to the div wrapper or try to pass it to the component.

    // Wait, looking at the previous code, we didn't have onKeyDown on VSCodeTextField.
    // We will attach it to the VSCodeTextField.

    if (e.key === 'Enter') {
      // For text fields, Enter usually means save.
      onSave?.();
    } else if (e.key === 'Escape') {
      onCancel?.();
    }
  };

  const displayError = error || localError;

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
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onInput={(e: any) => {
          const newValue = e.target.value ?? '';
          onChange(newValue);
          if (localError && validator) {
            const validationError = validator(newValue);
            setLocalError(validationError);
          }
        }}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        style={
          {
            '--input-border-color': displayError
              ? 'var(--vscode-inputValidation-errorBorder)'
              : undefined,
          } as React.CSSProperties
        }
      />
      {displayError && (
        <span className="text-xs" style={{ color: 'var(--vscode-errorForeground)' }}>
          {displayError}
        </span>
      )}
    </div>
  );
};
