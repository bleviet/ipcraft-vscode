import React from 'react';
import { VSCodeCheckbox } from '@vscode/webview-ui-toolkit/react';

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
 * Uses VSCode Web UI Toolkit for native VS Code look and feel
 */
export const CheckboxField: React.FC<CheckboxFieldProps> = ({
  label,
  checked,
  onChange,
  disabled = false,
  'data-edit-key': dataEditKey,
}) => {
  return (
    <VSCodeCheckbox
      data-edit-key={dataEditKey}
      checked={checked}
      disabled={disabled}
      onChange={(e: any) => onChange(e.target.checked)}
    >
      {label}
    </VSCodeCheckbox>
  );
};
