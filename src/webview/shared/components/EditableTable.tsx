import React from 'react';

export interface EditableTableColumn {
  key: string;
  header: string;
  align?: 'left' | 'right';
}

export interface EditableTableProps<T> {
  title: string;
  rows: T[];
  rowLabelSingular: string;
  rowLabelPlural?: string;
  keyboardHint?: string;
  addButtonLabel: string;
  onAdd: () => void;
  disableAdd?: boolean;
  columns: EditableTableColumn[];
  editingIndex: number | null;
  isAdding: boolean;
  renderDisplayRow: (row: T, index: number) => React.ReactNode;
  renderEditRow: (isNew: boolean) => React.ReactNode;
  emptyMessage: string;
  emptyColSpan?: number;
  containerRef?: React.RefObject<HTMLDivElement>;
  showHeaderSection?: boolean;
  containerClassName?: string;
  showTableBorder?: boolean;
  tableWrapperClassName?: string;
  tableClassName?: string;
  renderTableContent?: () => React.ReactNode;
}

/**
 * Generic editable table shell with inline add/edit row support.
 * Row rendering and edit controls are provided by consumers.
 */
export function EditableTable<T>({
  title,
  rows,
  rowLabelSingular,
  rowLabelPlural,
  keyboardHint,
  addButtonLabel,
  onAdd,
  disableAdd = false,
  columns,
  editingIndex,
  isAdding,
  renderDisplayRow,
  renderEditRow,
  emptyMessage,
  emptyColSpan,
  containerRef,
  showHeaderSection = true,
  containerClassName = 'p-6 space-y-4 outline-none',
  showTableBorder = true,
  tableWrapperClassName = 'rounded overflow-hidden',
  tableClassName = 'w-full',
  renderTableContent,
}: EditableTableProps<T>) {
  const resolvedPlural = rowLabelPlural ?? `${rowLabelSingular}s`;

  return (
    <div ref={containerRef} className={containerClassName} tabIndex={0}>
      {showHeaderSection ? (
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-medium">{title}</h2>
            <p className="text-sm mt-1" style={{ opacity: 0.7 }}>
              {rows.length} {rows.length === 1 ? rowLabelSingular : resolvedPlural}
              {keyboardHint ? (
                <span className="ml-2 text-xs font-mono" style={{ opacity: 0.5 }}>
                  {keyboardHint}
                </span>
              ) : null}
            </p>
          </div>
          <button
            onClick={onAdd}
            disabled={disableAdd}
            className="px-4 py-2 rounded text-sm font-medium flex items-center gap-2"
            style={{
              background: disableAdd
                ? 'var(--vscode-button-secondaryBackground)'
                : 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
              opacity: disableAdd ? 0.5 : 1,
            }}
          >
            <span className="codicon codicon-add"></span>
            {addButtonLabel}
          </button>
        </div>
      ) : null}

      <div
        className={tableWrapperClassName}
        style={showTableBorder ? { border: '1px solid var(--vscode-panel-border)' } : undefined}
      >
        <table className={tableClassName}>
          {renderTableContent ? (
            renderTableContent()
          ) : (
            <>
              <thead>
                <tr
                  style={{
                    background: 'var(--vscode-editor-background)',
                    borderBottom: '1px solid var(--vscode-panel-border)',
                  }}
                >
                  {columns.map((column) => (
                    <th
                      key={column.key}
                      className={`px-4 py-3 ${column.align === 'right' ? 'text-right' : 'text-left'} text-xs font-semibold uppercase opacity-70`}
                    >
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  if (editingIndex === index) {
                    return <React.Fragment key={index}>{renderEditRow(false)}</React.Fragment>;
                  }

                  return renderDisplayRow(row, index);
                })}

                {isAdding && renderEditRow(true)}

                {rows.length === 0 && !isAdding && (
                  <tr>
                    <td
                      colSpan={emptyColSpan ?? columns.length}
                      className="px-4 py-8 text-center text-sm"
                      style={{ opacity: 0.6 }}
                    >
                      {emptyMessage}
                    </td>
                  </tr>
                )}
              </tbody>
            </>
          )}
        </table>
      </div>
    </div>
  );
}
