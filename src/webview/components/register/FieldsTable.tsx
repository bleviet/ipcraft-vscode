import React from 'react';
import type { YamlUpdateHandler } from '../../types/editor';
import { EditableTable } from '../../shared/components';
import type { EditKey, FieldEditorState } from '../../hooks/useFieldEditor';
import FieldTableRow from './FieldTableRow';

export interface FieldDef {
  name?: string | null;
  bits?: string | null;
  bit_offset?: number | null;
  bit_width?: number | null;
  bit_range?: [number, number] | null;
  access?: string | null;
  reset_value?: number | null;
  description?: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FIELD_TABLE_COLUMNS = [
  { key: 'name', header: 'Name' },
  { key: 'bits', header: 'Bit(s)' },
  { key: 'access', header: 'Access' },
  { key: 'reset', header: 'Reset' },
  { key: 'description', header: 'Description' },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FieldsTableProps {
  /** Normalised bit fields for the current register. */
  fields: FieldDef[];
  /** Register width in bits (used for overflow validation). */
  registerSize: number;
  /** Callback to commit a YAML path + value change. */
  onUpdate: YamlUpdateHandler;
  /** All editing state from the useFieldEditor hook. */
  fieldEditor: FieldEditorState;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders the editable bit fields table for a register, including the
 * move-up/move-down toolbar.
 * Delegates insertion/deletion/editing to the useFieldEditor hook state.
 */
export function FieldsTable({ fields, registerSize, onUpdate, fieldEditor }: FieldsTableProps) {
  const {
    selectedFieldIndex,
    setSelectedFieldIndex,
    setHoveredFieldIndex,
    setSelectedEditKey,
    setActiveCell,
    insertError,
    focusRef,
    errorRef,
    ensureDraftsInitialized,
    moveSelectedField,
  } = fieldEditor;

  const setActiveEditorCell = (
    index: number,
    key: EditKey,
    options?: { initializeDrafts?: boolean }
  ) => {
    const shouldInitializeDrafts = options?.initializeDrafts ?? true;
    if (shouldInitializeDrafts) {
      ensureDraftsInitialized(index);
    }
    setSelectedFieldIndex(index);
    setHoveredFieldIndex(index);
    setSelectedEditKey(key);
    setActiveCell({ rowIndex: index, key });
  };

  const handleCellClick = (
    index: number,
    key: EditKey,
    options?: { initializeDrafts?: boolean }
  ) => {
    return (e: React.MouseEvent<HTMLElement>) => {
      e.stopPropagation();
      setActiveEditorCell(index, key, options);
    };
  };

  const handleCellFocus = (
    index: number,
    key: EditKey,
    options?: { initializeDrafts?: boolean }
  ) => {
    return () => {
      setActiveEditorCell(index, key, options);
    };
  };

  const handleRowClick = (index: number) => {
    setSelectedFieldIndex(index);
    setHoveredFieldIndex(index);
    setActiveCell((prev) => ({ rowIndex: index, key: prev.key }));
    ensureDraftsInitialized(index);
  };

  return (
    <div className="flex-1 flex overflow-hidden min-h-0">
      <div className="flex-1 vscode-surface border-r vscode-border min-h-0 flex flex-col">
        {/* Toolbar: move up / move down */}
        <div className="shrink-0 px-4 py-2 border-b vscode-border vscode-surface flex items-center justify-end gap-1">
          <button
            className="p-2 rounded-md transition-colors disabled:opacity-40 vscode-icon-button"
            onClick={() => moveSelectedField(-1)}
            disabled={selectedFieldIndex <= 0}
            title="Move field up"
            type="button"
          >
            <span className="codicon codicon-chevron-up"></span>
          </button>
          <button
            className="p-2 rounded-md transition-colors disabled:opacity-40 vscode-icon-button"
            onClick={() => moveSelectedField(1)}
            disabled={selectedFieldIndex < 0 || selectedFieldIndex >= fields.length - 1}
            title="Move field down"
            type="button"
          >
            <span className="codicon codicon-chevron-down"></span>
          </button>
        </div>

        {/* Scrollable table */}
        <div
          ref={focusRef}
          tabIndex={0}
          data-fields-table="true"
          className="flex-1 overflow-auto min-h-0 outline-none focus:outline-none"
          style={{ overflowY: 'auto', overflowX: 'auto' }}
        >
          {insertError ? (
            <div ref={errorRef} className="vscode-error px-4 py-2 text-xs">
              {insertError}
            </div>
          ) : null}

          <EditableTable
            rows={fields}
            columns={FIELD_TABLE_COLUMNS}
            showHeaderSection={false}
            showTableBorder={false}
            containerClassName=""
            tableWrapperClassName=""
            tableClassName="w-full text-left border-collapse table-fixed"
            renderTableContent={() => (
              <>
                <colgroup>
                  <col className="w-[18%] min-w-[120px]" />
                  <col className="w-[14%] min-w-[100px]" />
                  <col className="w-[14%] min-w-[120px]" />
                  <col className="w-[14%] min-w-[110px]" />
                  <col className="w-[40%] min-w-[240px]" />
                </colgroup>
                <thead className="vscode-surface-alt text-xs font-semibold vscode-muted uppercase tracking-wider sticky top-0 z-10 shadow-sm">
                  <tr className="h-12">
                    <th className="px-6 py-3 border-b vscode-border align-middle">Name</th>
                    <th className="px-4 py-3 border-b vscode-border align-middle">Bit(s)</th>
                    <th className="px-4 py-3 border-b vscode-border align-middle">Access</th>
                    <th className="px-4 py-3 border-b vscode-border align-middle">Reset</th>
                    <th className="px-6 py-3 border-b vscode-border align-middle">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y vscode-border text-sm">
                  {fields.map((field, index) => (
                    <FieldTableRow
                      key={`${String(field.name ?? `field-${index}`)}-${String(field.bit_offset ?? field.bits ?? index)}`}
                      field={field}
                      index={index}
                      fields={fields}
                      registerSize={registerSize}
                      onUpdate={onUpdate}
                      fieldEditor={fieldEditor}
                      onRowClick={handleRowClick}
                      onCellClick={handleCellClick}
                      onCellFocus={handleCellFocus}
                    />
                  ))}
                </tbody>
              </>
            )}
          />
        </div>
      </div>
    </div>
  );
}
