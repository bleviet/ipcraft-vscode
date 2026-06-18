import React from 'react';
import type { YamlUpdateHandler } from '../../types/editor';
import { EditableTable, HoverInsertBar } from '../../shared/components';
import type { EditKey, FieldEditorState } from '../../hooks/useFieldEditor';
import FieldTableRow from './FieldTableRow';

export interface FieldDef {
  name?: string | null;
  bits?: string | null;
  offset?: number | null;
  width?: number | null;
  bitRange?: [number, number] | null;
  access?: string | null;
  resetValue?: number | null;
  description?: string | null;
  monitorChangeOf?: string | null;
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
    wrappedFields,
    selectedFieldIndex,
    setSelectedFieldIndex,
    setHoveredFieldIndex,
    setSelectedEditKey,
    setActiveCell,
    insertError,
    focusRef,
    ensureDraftsInitialized,
    captureEditSnapshot,
    moveSelectedField,
    dragState,
    onDragHandlePointerDown,
    onPointerEnterRow,
    onDragMove,
    insertHoverGap,
    insertBarScrollY,
    insertBarTbodyProps,
    insertBarHoverProps,
    insertFieldAtGap,
  } = fieldEditor;

  const setActiveEditorCell = (
    index: number,
    rowId: string,
    key: EditKey,
    options?: { initializeDrafts?: boolean }
  ) => {
    const shouldInitializeDrafts = options?.initializeDrafts ?? true;
    if (shouldInitializeDrafts) {
      ensureDraftsInitialized(rowId, index);
    }
    setSelectedFieldIndex(index);
    setHoveredFieldIndex(index);
    setSelectedEditKey(key);
    setActiveCell({ rowId, key });
  };

  const handleCellClick = (
    index: number,
    rowId: string,
    key: EditKey,
    options?: { initializeDrafts?: boolean }
  ) => {
    return (e: React.MouseEvent<HTMLElement>) => {
      e.stopPropagation();
      setActiveEditorCell(index, rowId, key, options);
    };
  };

  const handleCellFocus = (
    index: number,
    rowId: string,
    key: EditKey,
    options?: { initializeDrafts?: boolean }
  ) => {
    return () => {
      captureEditSnapshot();
      setActiveEditorCell(index, rowId, key, options);
    };
  };

  const handleRowClick = (index: number, rowId: string) => {
    setSelectedFieldIndex(index);
    setHoveredFieldIndex(index);
    setActiveCell((prev) => ({ rowId, key: prev.key }));
    ensureDraftsInitialized(rowId, index);
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
          ref={focusRef as React.RefObject<HTMLDivElement>}
          tabIndex={0}
          data-fields-table="true"
          className={`flex-1 overflow-auto min-h-0 outline-none focus:outline-none relative${dragState.active ? ' cursor-grabbing select-none' : ''}`}
          style={{ overflowY: 'auto', overflowX: 'auto' }}
        >
          {insertError ? <div className="vscode-error px-4 py-2 text-xs">{insertError}</div> : null}

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
                  <col className="w-8" />
                  <col className="w-[18%] min-w-[120px]" />
                  <col className="w-[14%] min-w-[100px]" />
                  <col className="w-[14%] min-w-[120px]" />
                  <col className="w-[14%] min-w-[110px]" />
                  <col className="w-[40%] min-w-[240px]" />
                </colgroup>
                <thead className="vscode-surface-alt text-xs font-semibold vscode-muted uppercase tracking-wider sticky top-0 z-10 shadow-sm">
                  <tr className="h-12">
                    <th className="w-8 border-b vscode-border" />
                    <th className="px-6 py-3 border-b vscode-border align-middle">Name</th>
                    <th className="px-4 py-3 border-b vscode-border align-middle">Bit(s)</th>
                    <th className="px-4 py-3 border-b vscode-border align-middle">Access</th>
                    <th className="px-4 py-3 border-b vscode-border align-middle">Reset</th>
                    <th className="px-6 py-3 border-b vscode-border align-middle">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y vscode-border text-sm" {...insertBarTbodyProps}>
                  {wrappedFields.map((wrapped, index) => (
                    <FieldTableRow
                      key={wrapped.rowId}
                      field={wrapped.model}
                      rowId={wrapped.rowId}
                      index={index}
                      fields={fields}
                      registerSize={registerSize}
                      onUpdate={onUpdate}
                      fieldEditor={fieldEditor}
                      onRowClick={(idx) => handleRowClick(idx, wrapped.rowId)}
                      onCellClick={(idx, key, opt) => handleCellClick(idx, wrapped.rowId, key, opt)}
                      onCellFocus={(idx, key, opt) => handleCellFocus(idx, wrapped.rowId, key, opt)}
                      isDragSource={dragState.active && dragState.fromRowId === wrapped.rowId}
                      isDragTarget={
                        dragState.active &&
                        dragState.fromRowId !== wrapped.rowId &&
                        dragState.toRowId === wrapped.rowId
                      }
                      dragTargetPosition={
                        dragState.active &&
                        dragState.fromRowId !== wrapped.rowId &&
                        dragState.toRowId === wrapped.rowId
                          ? dragState.position
                          : null
                      }
                      onDragHandlePointerDown={(e) => onDragHandlePointerDown(wrapped.rowId, e)}
                      onPointerEnterRow={() => onPointerEnterRow(wrapped.rowId)}
                      onDragMove={onDragMove}
                    />
                  ))}
                </tbody>
              </>
            )}
          />
          <HoverInsertBar
            gapIndex={insertHoverGap}
            positionY={insertBarScrollY}
            itemLabel="field"
            onInsert={(gapIndex) => insertFieldAtGap(gapIndex)}
            {...insertBarHoverProps}
          />
        </div>
      </div>
    </div>
  );
}
