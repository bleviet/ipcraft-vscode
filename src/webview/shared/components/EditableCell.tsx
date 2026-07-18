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
  /**
   * Hover tooltip text for the cell. Defaults to "Double-click to edit".
   * Pass `null` to omit the `data-tooltip` attribute entirely (e.g. a
   * dropdown cell that opens on a single click and has its own
   * self-explanatory affordance, so "Double-click to edit" would be wrong).
   */
  tooltip?: string | null;
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
  tooltip = 'Double-click to edit',
  children,
}: EditableCellProps) {
  return (
    <td
      data-col-key={columnKey}
      {...(tooltip !== null ? { 'data-tooltip': tooltip } : {})}
      className={`relative align-middle ${isActive ? 'vscode-cell-active' : ''} ${className}`}
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
