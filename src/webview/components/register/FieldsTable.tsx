import React, { useMemo, useState } from 'react';
import type { YamlUpdateHandler } from '../../types/editor';
import { EditableTable, TableContextMenu } from '../../shared/components';
import { computeReorderPreview } from '../../utils/reorderPreview';
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
  /** Register value label/hex-dec editor, rendered in the toolbar above the table. */
  valueBar?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders the editable bit fields table for a register, including the
 * move-up/move-down toolbar.
 * Delegates insertion/deletion/editing to the useFieldEditor hook state.
 */
export function FieldsTable({
  fields,
  registerSize,
  onUpdate,
  fieldEditor,
  valueBar,
}: FieldsTableProps) {
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
    deleteField,
  } = fieldEditor;

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    rowId: string;
  } | null>(null);

  const closeContextMenu = () => setContextMenu(null);

  // Live drag-reorder preview: reflow the rendered rows into the prospective
  // drop order while a drag is in progress, mirroring the register-map
  // visualizer. Each row keeps its real index so editing/commit are unaffected.
  const displayFields = useMemo(() => {
    const base = wrappedFields.map((wrapped, index) => ({ wrapped, index }));
    if (!dragState.active || !dragState.fromRowId || !dragState.toRowId) {
      return base;
    }
    const fromIdx = wrappedFields.findIndex((w) => w.rowId === dragState.fromRowId);
    const toIdx = wrappedFields.findIndex((w) => w.rowId === dragState.toRowId);
    return computeReorderPreview(base.length, fromIdx, toIdx, dragState.position === 'bottom').map(
      (realIdx) => base[realIdx]
    );
  }, [wrappedFields, dragState]);

  const handleRowContextMenu = (rowId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedFieldIndex(wrappedFields.findIndex((w) => w.rowId === rowId));
    setContextMenu({ x: e.clientX, y: e.clientY, rowId });
  };

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
      <div className="flex-1 vscode-surface border-r vscode-border min-h-0 min-w-0 flex flex-col">
        {/* Toolbar: register value + move up/down */}
        <div className="shrink-0 px-4 py-2 border-b vscode-border vscode-surface flex items-center justify-between gap-2">
          <div className="flex-1 min-w-0">{valueBar}</div>
          {fields.length > 0 ? (
            <div className="flex items-center gap-1 shrink-0">
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
          ) : null}
        </div>

        {fields.length === 0 ? (
          <div
            ref={focusRef as React.RefObject<HTMLDivElement>}
            tabIndex={0}
            data-fields-table="true"
            className="flex-1 flex flex-col items-center justify-center p-8 text-center vscode-surface outline-none focus:outline-none"
          >
            <button
              onClick={() => fieldEditor.insertField()}
              className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-md"
              style={{
                background: 'var(--vscode-button-background)',
                color: 'var(--vscode-button-foreground)',
                border: 'none',
                cursor: 'pointer',
              }}
              title="Add first bit field"
              type="button"
            >
              <span className="codicon codicon-plus text-xl"></span>
            </button>
            <div className="mt-4 text-xs text-center space-y-1">
              <div className="vscode-muted">
                Or press{' '}
                <kbd className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-white/10 border border-white/10">
                  o
                </kbd>{' '}
                key when focused
              </div>
              <div className="vscode-muted">
                Or{' '}
                <kbd className="px-1.5 py-0.5 rounded font-mono text-[10px] bg-white/10 border border-white/10">
                  Shift + Drag
                </kbd>{' '}
                in the visualizer
              </div>
            </div>
          </div>
        ) : (
          <div
            ref={focusRef as React.RefObject<HTMLDivElement>}
            tabIndex={0}
            data-fields-table="true"
            className={`flex-1 overflow-auto min-h-0 outline-none focus:outline-none${dragState.active ? ' cursor-grabbing select-none' : ''}`}
            style={{ overflowY: 'auto', overflowX: 'auto' }}
          >
            {insertError ? (
              <div className="vscode-error px-4 py-2 text-xs">{insertError}</div>
            ) : null}

            <EditableTable
              rows={fields}
              columns={FIELD_TABLE_COLUMNS}
              showHeaderSection={false}
              showTableBorder={false}
              containerClassName=""
              tableWrapperClassName=""
              tableClassName="w-full min-w-[722px] text-left border-collapse table-fixed"
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
                  <tbody className="divide-y vscode-border text-sm">
                    {displayFields.map(({ wrapped, index }) => (
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
                        onCellClick={(idx, key, opt) =>
                          handleCellClick(idx, wrapped.rowId, key, opt)
                        }
                        onCellFocus={(idx, key, opt) =>
                          handleCellFocus(idx, wrapped.rowId, key, opt)
                        }
                        isDragSource={dragState.active && dragState.fromRowId === wrapped.rowId}
                        onDragHandlePointerDown={(e) => onDragHandlePointerDown(wrapped.rowId, e)}
                        onPointerEnterRow={() => onPointerEnterRow(wrapped.rowId)}
                        onDragMove={onDragMove}
                        onContextMenu={(e) => handleRowContextMenu(wrapped.rowId, e)}
                      />
                    ))}
                  </tbody>
                </>
              )}
            />
          </div>
        )}
      </div>
      <TableContextMenu
        position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        onDelete={() => {
          if (contextMenu) {
            deleteField(contextMenu.rowId);
          }
        }}
        onClose={closeContextMenu}
      />
    </div>
  );
}
