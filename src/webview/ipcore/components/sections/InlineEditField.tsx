import React from 'react';

interface InlineEditFieldProps {
  type?: 'text' | 'number';
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
  placeholder?: string;
  min?: string;
  width?: string;
  fullWidth?: boolean;
  leadingContent?: React.ReactNode;
  inputStyle?: React.CSSProperties;
  inputClassName?: string;
  containerClassName?: string;
}

export const InlineEditField: React.FC<InlineEditFieldProps> = ({
  type = 'text',
  value,
  onChange,
  onSave,
  onCancel,
  placeholder,
  min,
  width,
  fullWidth = false,
  leadingContent,
  inputStyle,
  inputClassName,
  containerClassName,
}) => {
  return (
    <div className={containerClassName ?? `flex items-center gap-1${fullWidth ? ' flex-1' : ''}`}>
      {leadingContent}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClassName ?? `px-1 py-0.5 rounded${fullWidth ? ' flex-1' : ''}`}
        style={{
          background: 'var(--vscode-input-background)',
          border: '1px solid var(--vscode-input-border)',
          color: 'var(--vscode-input-foreground)',
          outline: 'none',
          fontSize: 'inherit',
          width,
          ...inputStyle,
        }}
        placeholder={placeholder}
        autoFocus
        min={min}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            onSave();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSave();
        }}
        className="px-1.5 py-0.5 rounded text-xs"
        style={{
          background: 'var(--vscode-button-background)',
          color: 'var(--vscode-button-foreground)',
        }}
      >
        Save
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onCancel();
        }}
        className="px-1.5 py-0.5 rounded text-xs"
        style={{
          background: 'var(--vscode-button-secondaryBackground)',
          color: 'var(--vscode-button-foreground)',
        }}
      >
        Cancel
      </button>
    </div>
  );
};
