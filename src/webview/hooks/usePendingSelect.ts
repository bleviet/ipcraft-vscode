import { useEffect } from 'react';
import type { TableRowWrapper } from './useTableEditorState';
import type { ColumnKey } from './useTableNavigation';

export interface PendingSelectTarget<TColumnKey> {
  name: string;
  key: TColumnKey;
}

/**
 * Handles post-insert row selection for table editors.
 *
 * Callers create the refs with `useRef` and set them before triggering an update.
 * This hook wires up the `useEffect` that resolves the pending selection once
 * the new row appears in the reconciled list:
 *
 * - `pendingSelectRef`: keyboard-triggered insert — selects the new row only.
 * - `pendingInsertFocusRef`: mouse-triggered insert — selects, focuses the cell
 *   editor, and scrolls the row into view so the user can type immediately.
 */
export function usePendingSelect<TRow extends { name?: string }, TColumnKey extends ColumnKey>(
  rows: TableRowWrapper<TRow>[],
  editor: {
    selectRow: (idx: number, key?: TColumnKey) => void;
    focusCellEditor: (rowId: string, key: TColumnKey) => void;
  },
  pendingSelectRef: React.MutableRefObject<PendingSelectTarget<TColumnKey> | null>,
  pendingInsertFocusRef?: React.MutableRefObject<PendingSelectTarget<TColumnKey> | null>,
  rowSelectorAttr = 'data-row-id'
): void {
  useEffect(() => {
    if (pendingInsertFocusRef?.current) {
      const { name, key } = pendingInsertFocusRef.current;
      const index = rows.findIndex((w) => w.model.name === name);
      if (index >= 0) {
        const rowId = rows[index].rowId;
        editor.selectRow(index, key);
        editor.focusCellEditor(rowId, key);
        document
          .querySelector(`tr[${rowSelectorAttr}="${rowId}"]`)
          ?.scrollIntoView({ block: 'center' });
        pendingInsertFocusRef.current = null;
      }
    }
    if (pendingSelectRef.current) {
      const { name, key } = pendingSelectRef.current;
      const index = rows.findIndex((w) => w.model.name === name);
      if (index >= 0) {
        const rowId = rows[index].rowId;
        editor.selectRow(index, key);
        document
          .querySelector(`tr[${rowSelectorAttr}="${rowId}"]`)
          ?.scrollIntoView({ block: 'center' });
        pendingSelectRef.current = null;
      }
    }
  }, [rows, editor]);
}
