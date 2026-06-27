import React from 'react';

export interface EditableCellProps {
  /** Column key for navigation and data-attributes. */
  columnKey: string;
  /** Whether this cell is the active cell. */
  isActive: boolean;
  /** Called when the cell is clicked. */
  onCellClick: (e: React.MouseEvent<HTMLElement>) => void;
  /** CSS class for the <td>. */
  className?: string;
  /** Inline style overrides. */
  style?: React.CSSProperties;
  children: React.ReactNode;
}

/**
 * Shared wrapper for an editable table cell.
 * Handles styling the active state and cell click events.
 */
export function EditableCell({
  columnKey,
  isActive,
  onCellClick,
  className = '',
  style,
  children,
}: EditableCellProps) {
  return (
    <td
      data-col-key={columnKey}
      title="Double-click to edit"
      className={`align-middle ${isActive ? 'vscode-cell-active' : ''} ${className}`}
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onCellClick(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        const input = e.currentTarget.querySelector(`[data-edit-key="${columnKey}"]`);
        (input as HTMLElement | null)?.focus();
      }}
    >
      {children}
    </td>
  );
}
