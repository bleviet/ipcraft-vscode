import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useCellEditGuard } from './useCellEditGuard';
import { useHoverInsertBar } from './useHoverInsertBar';
import { useTableNavigation, type ActiveCell, type ColumnKey } from './useTableNavigation';
import type { YamlUpdateHandler } from '../types/editor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseTableEditorStateOptions<TRow, TColumnKey extends ColumnKey> {
  /** The live rows array from the parent's data model. */
  rows: TRow[];
  /** Path fragment used in useCellEditGuard (e.g. ['registers']). */
  rowsPath: (string | number)[];
  /** Ordered column keys for navigation. */
  columnOrder: readonly TColumnKey[];
  /** Callback to commit changes to the YAML document. */
  onUpdate: YamlUpdateHandler;
  /** Optional data-attribute name for row selector (default: 'data-row-idx'). */
  rowSelectorAttr?: string;
  /** Optional callbacks for custom insert logic. */
  onInsertAfter?: () => void;
  onInsertBefore?: () => void;
  /** Optional callback for custom move logic (row swap). */
  onMove?: (fromIndex: number, delta: number) => void;
  /** Optional callback for custom delete logic. */
  onDelete?: (rowIndex: number) => void;
  /** Optional onAfterRevert callback forwarded to useCellEditGuard. */
  onAfterRevert?: (snapshot: TRow[]) => void;
  /** Whether to enable HoverInsertBar tracking. Default: true. */
  enableHoverInsert?: boolean;
  /** Extra dependency values that should trigger the selection clamp effect. */
  clampDeps?: unknown[];
  /** When false the table holds no selection (index -1). Default: true. */
  isActive?: boolean;
}

export interface UseTableEditorStateReturn<TColumnKey extends ColumnKey> {
  // Selection
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  hoveredIndex: number | null;
  setHoveredIndex: React.Dispatch<React.SetStateAction<number | null>>;
  activeCell: ActiveCell<TColumnKey>;
  setActiveCell: React.Dispatch<React.SetStateAction<ActiveCell<TColumnKey>>>;

  // Cell edit guard
  cancelEditRef: React.MutableRefObject<boolean>;
  captureEditSnapshot: () => void;

  // Hover insert bar
  insertHoverGap: number | null;
  insertBarScrollY: number | null;
  insertBarTbodyProps: {
    onMouseMove: (e: React.MouseEvent<HTMLTableSectionElement>) => void;
    onMouseLeave: () => void;
  };
  insertBarHoverProps: {
    onMouseEnter: () => void;
    onMouseLeave: () => void;
  };
  clearInsertBar: () => void;

  // Container ref
  containerRef: React.RefObject<HTMLDivElement | null>;

  // Row interaction helpers
  handleRowClick: (idx: number) => void;
  handleCellClick: (idx: number, key: TColumnKey) => void;
  handleMouseEnter: (idx: number) => void;
  handleMouseLeave: () => void;

  // Convenience: select a row and update all three state values
  selectRow: (idx: number, key?: TColumnKey) => void;

  // Focus the edit input in a specific cell after a short delay
  focusCellEditor: (rowIndex: number, key: TColumnKey) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Consolidated table-editor orchestration hook.
 *
 * Composes `useCellEditGuard`, `useHoverInsertBar`, and `useTableNavigation`
 * together with shared selection / hover / active-cell state and the
 * clamp-on-change effect.  Replaces ~100 lines of identical boilerplate that
 * was previously duplicated in BlockEditor, MemoryMapEditor, and
 * RegisterArrayEditor.
 */
export function useTableEditorState<TRow, TColumnKey extends ColumnKey>({
  rows,
  rowsPath,
  columnOrder,
  onUpdate,
  rowSelectorAttr,
  onInsertAfter,
  onInsertBefore,
  onMove,
  onDelete,
  onAfterRevert,
  enableHoverInsert = true,
  clampDeps,
  isActive = true,
}: UseTableEditorStateOptions<TRow, TColumnKey>): UseTableEditorStateReturn<TColumnKey> {
  const firstColumn = columnOrder[0];

  // ---- Selection state ----
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [activeCell, setActiveCell] = useState<ActiveCell<TColumnKey>>({
    rowIndex: -1,
    key: firstColumn,
  });

  // ---- Container ref ----
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ---- Cell edit guard ----
  const { cancelEditRef, captureEditSnapshot } = useCellEditGuard({
    rows,
    rowsPath,
    onUpdate,
    containerRef: containerRef as React.RefObject<HTMLElement>,
    onAfterRevert,
  });

  // ---- Hover insert bar ----
  const hoverInsert = useHoverInsertBar(containerRef as React.RefObject<HTMLElement>);

  // ---- Clamp selection when data changes ----
  const extraDeps = clampDeps ?? [];
  useEffect(() => {
    // Inactive tables hold no selection so a collapsed/unfocused editor never
    // paints a phantom row highlight.
    if (!isActive || rows.length === 0) {
      setSelectedIndex(-1);
      setActiveCell({ rowIndex: -1, key: firstColumn });
      return;
    }
    setSelectedIndex((prev) => {
      if (prev < 0) {
        return 0;
      }
      if (prev >= rows.length) {
        return rows.length - 1;
      }
      return prev;
    });
    setActiveCell((prev) => {
      const rowIndex = prev.rowIndex < 0 ? 0 : Math.min(rows.length - 1, prev.rowIndex);
      const key = (columnOrder as readonly string[]).includes(prev.key) ? prev.key : firstColumn;
      return { rowIndex, key: key };
    });
  }, [rows.length, firstColumn, isActive, ...extraDeps]);

  // ---- Convenience: select a row ----
  const selectRow = useCallback((idx: number, key?: TColumnKey) => {
    setSelectedIndex(idx);
    setHoveredIndex(idx);
    if (key) {
      setActiveCell({ rowIndex: idx, key });
    } else {
      setActiveCell((prev) => ({ rowIndex: idx, key: prev.key }));
    }
  }, []);

  // ---- Focus a cell's editor input ----
  const focusCellEditor = useCallback(
    (rowIndex: number, key: TColumnKey) => {
      window.setTimeout(() => {
        const attr = rowSelectorAttr ?? 'data-row-idx';
        const row = document.querySelector(`tr[${attr}="${rowIndex}"]`);
        const editor = row?.querySelector(`[data-edit-key="${key}"]`) as HTMLElement | null;
        editor?.focus?.();
      }, 0);
    },
    [rowSelectorAttr]
  );

  // ---- Table navigation ----
  useTableNavigation<TColumnKey>({
    activeCell,
    setActiveCell: (cell) => {
      setActiveCell(cell);
      if (cell.rowIndex >= 0 && cell.rowIndex < rows.length) {
        setSelectedIndex(cell.rowIndex);
        setHoveredIndex(cell.rowIndex);
      }
    },
    rowCount: rows.length,
    columnOrder: [...columnOrder],
    containerRef: containerRef as React.RefObject<HTMLElement>,
    onEdit: (rowIndex, key) => {
      if (rowIndex < 0 || rowIndex >= rows.length) {
        return;
      }
      selectRow(rowIndex, key);
      focusCellEditor(rowIndex, key);
    },
    onDelete: onDelete
      ? (rowIndex) => {
          if (rowIndex < 0 || rowIndex >= rows.length) {
            return;
          }
          onDelete(rowIndex);
        }
      : undefined,
    onMove,
    onInsertAfter,
    onInsertBefore,
    isActive: true,
    rowSelectorAttr,
  });

  // ---- Row interaction helpers ----
  const handleRowClick = useCallback(
    (idx: number) => {
      selectRow(idx);
    },
    [selectRow]
  );

  const handleCellClick = useCallback(
    (idx: number, key: TColumnKey) => {
      selectRow(idx, key);
    },
    [selectRow]
  );

  const handleMouseEnter = useCallback((idx: number) => {
    setHoveredIndex(idx);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(null);
  }, []);

  return {
    // Selection
    selectedIndex,
    setSelectedIndex,
    hoveredIndex,
    setHoveredIndex,
    activeCell,
    setActiveCell,

    // Cell edit guard
    cancelEditRef,
    captureEditSnapshot,

    // Hover insert bar
    insertHoverGap: enableHoverInsert ? hoverInsert.insertHoverGap : null,
    insertBarScrollY: enableHoverInsert ? hoverInsert.insertBarScrollY : null,
    insertBarTbodyProps: hoverInsert.tbodyProps,
    insertBarHoverProps: hoverInsert.barProps,
    clearInsertBar: hoverInsert.clear,

    // Container ref
    containerRef,

    // Row interaction helpers
    handleRowClick,
    handleCellClick,
    handleMouseEnter,
    handleMouseLeave,

    // Convenience
    selectRow,
    focusCellEditor,
  };
}
