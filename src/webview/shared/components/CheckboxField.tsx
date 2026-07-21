import React from 'react';

export interface CheckboxFieldProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /** Additional data attribute for edit key (vim navigation) */
  'data-edit-key'?: string;
}

/**
 * Checkbox field for boolean values
 * Uses a semantic native checkbox styled with VS Code theme tokens.
 */
export const CheckboxField: React.FC<CheckboxFieldProps> = ({
  label,
  checked,
  onChange,
  disabled = false,
  'data-edit-key': dataEditKey,
}) => {
  return (
    <label className="vscode-checkbox-label">
      <input
        type="checkbox"
        className="vscode-checkbox"
        data-edit-key={dataEditKey}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
};
