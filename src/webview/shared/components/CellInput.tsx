import React from 'react';
import {
  VSCodeTextField,
  VSCodeTextArea,
  VSCodeDropdown,
  VSCodeOption,
} from '@vscode/webview-ui-toolkit/react';

export interface CellInputProps {
  /** Edit key for data-edit-key attribute. */
  editKey: string;
  /** Current display value. */
  value: string;
  /** Called on every input. */
  onInput: (value: string) => void;
  /** Called on blur (commit). Optional -- not all cells use blur-commit. */
  onBlur?: (value: string) => void;
  /** Called on focus (snapshot). */
  onFocus: () => void;
  /** If true, blur-commit is skipped (ESC was pressed). */
  cancelEditRef?: React.MutableRefObject<boolean>;
  /** Variant: 'text' | 'textarea' | 'dropdown'. Default: 'text'. */
  variant?: 'text' | 'textarea' | 'dropdown';
  /** Additional class name. */
  className?: string;
  /** Inline style overrides. */
  style?: React.CSSProperties;
  /** Options for dropdown variant. */
  options?: readonly string[];
}

/**
 * Shared input component for editable cells.
 * Enforces the standardized onInput + guarded onBlur commit strategy.
 */
export function CellInput({
  editKey,
  value,
  onInput,
  onBlur,
  onFocus,
  cancelEditRef,
  variant = 'text',
  className = '',
  style,
  options = [],
}: CellInputProps) {
  const handleInput = (e: Event | React.FormEvent<HTMLElement>) => {
    onInput((e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value);
  };

  const handleBlur = (e: Event | React.FocusEvent<HTMLElement>) => {
    if (cancelEditRef?.current) {
      return;
    }
    if (onBlur) {
      onBlur((e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value);
    } else {
      // Fallback to onInput if no onBlur is provided, to ensure final commit
      onInput((e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value);
    }
  };

  if (variant === 'dropdown') {
    return (
      <VSCodeDropdown
        data-edit-key={editKey}
        className={className}
        style={style}
        value={value}
        onFocus={onFocus}
        onChange={handleInput}
        onBlur={handleBlur}
      >
        {options.map((opt) => (
          <VSCodeOption key={opt} value={opt}>
            {opt}
          </VSCodeOption>
        ))}
      </VSCodeDropdown>
    );
  }

  if (variant === 'textarea') {
    return (
      <VSCodeTextArea
        data-edit-key={editKey}
        className={className}
        style={style}
        rows={1}
        value={value}
        onFocus={onFocus}
        onInput={handleInput}
        onBlur={handleBlur}
      />
    );
  }

  return (
    <VSCodeTextField
      data-edit-key={editKey}
      className={className}
      style={style}
      value={value}
      onFocus={onFocus}
      onInput={handleInput}
      onBlur={handleBlur}
    />
  );
}
