import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCellEditGuard } from './useCellEditGuard';
import { useHoverInsertBar } from './useHoverInsertBar';
import { useTableNavigation, type ActiveCell, type ColumnKey } from './useTableNavigation';
import type { YamlUpdateHandler } from '../types/editor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TableRowWrapper<TRow> {
  rowId: string;
  model: TRow;
}

export interface UseTableEditorStateOptions<TRow, TColumnKey extends ColumnKey> {
  /** Reconciled wrapped rows with stable rowId */
  rows: TableRowWrapper<TRow>[];
  /** Path fragment used in useCellEditGuard (e.g. ['registers']). */
  rowsPath: (string | number)[];
  /** Ordered column keys for navigation. */
  columnOrder: readonly TColumnKey[];
  /** Callback to commit changes to the YAML document. */
  onUpdate: YamlUpdateHandler;
  /** Optional data-attribute name for row selector (default: 'data-row-id'). */
  rowSelectorAttr?: string;
  /** Optional callbacks for custom insert logic. */
  onInsertAfter?: () => void;
  onInsertBefore?: () => void;
  /** Optional callback for custom move logic (row swap). */
  onMove?: (rowId: string, delta: number) => void;
  /** Optional callback for custom delete logic. */
  onDelete?: (rowId: string) => void;
  /** Optional onAfterRevert callback forwarded to useCellEditGuard. */
  onAfterRevert?: (snapshot: TRow[]) => void;
  /** Whether to enable HoverInsertBar tracking. Default: true. */
  enableHoverInsert?: boolean;
  /** CSS selector matching individual row elements, used by the hover insert bar to find gaps. Required when enableHoverInsert is true. */
  hoverRowSelector?: string;
  /** Extra dependency values that should trigger the selection clamp effect. */
  clampDeps?: unknown[];
  /** When false the table holds no selection. Default: true. */
  isActive?: boolean;
}

export interface UseTableEditorStateReturn<TColumnKey extends ColumnKey> {
  // Selection
  selectedRowId: string | null;
  setSelectedRowId: React.Dispatch<React.SetStateAction<string | null>>;
  hoveredRowId: string | null;
  setHoveredRowId: React.Dispatch<React.SetStateAction<string | null>>;
  activeCell: {
    rowId: string | null;
    rowIndex: number;
    key: TColumnKey;
  };
  setActiveCell: React.Dispatch<React.SetStateAction<ActiveCell<TColumnKey>>>;

  // Convenience index-based getters
  selectedIndex: number;
  hoveredIndex: number | null;

  // Convenience index-based setters / wrappers
  setSelectedFieldIndex: (idx: number | ((prev: number) => number)) => void;
  setHoveredFieldIndex: (idx: number | null | ((prev: number | null) => number | null)) => void;

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
  focusCellEditor: (rowId: string, key: TColumnKey) => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Consolidated table-editor orchestration hook.
 *
 * Uses rowId for stable row tracking.
 */
export function useTableEditorState<TRow, TColumnKey extends ColumnKey>({
  rows,
  rowsPath,
  columnOrder,
  onUpdate,
  rowSelectorAttr = 'data-row-id',
  onInsertAfter,
  onInsertBefore,
  onMove,
  onDelete,
  onAfterRevert,
  enableHoverInsert = true,
  hoverRowSelector,
  clampDeps,
  isActive = true,
}: UseTableEditorStateOptions<TRow, TColumnKey>): UseTableEditorStateReturn<TColumnKey> {
  const firstColumn = columnOrder[0];

  // ---- Selection state by rowId ----
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
  const [activeCellState, setActiveCellState] = useState<ActiveCell<TColumnKey>>({
    rowId: null,
    key: firstColumn,
  });

  // ---- Derived index mappings ----
  const lastKnownSelectedIndexRef = useRef<number>(0);

  const selectedIndex = useMemo(() => {
    const idx = selectedRowId ? rows.findIndex((r) => r.rowId === selectedRowId) : -1;
    if (idx !== -1) {
      lastKnownSelectedIndexRef.current = idx;
    }
    return idx;
  }, [rows, selectedRowId]);

  const hoveredIndex = useMemo(() => {
    return hoveredRowId ? rows.findIndex((r) => r.rowId === hoveredRowId) : null;
  }, [rows, hoveredRowId]);

  const activeCellRowIndex = useMemo(() => {
    return activeCellState.rowId ? rows.findIndex((r) => r.rowId === activeCellState.rowId) : -1;
  }, [rows, activeCellState.rowId]);

  const activeCell = useMemo(
    () => ({
      rowId: activeCellState.rowId,
      rowIndex: activeCellRowIndex,
      key: activeCellState.key,
    }),
    [activeCellState.rowId, activeCellRowIndex, activeCellState.key]
  );

  // ---- Container ref ----
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ---- Unwrap rows for useCellEditGuard ----
  const rawRows = useMemo(() => rows.map((r) => r.model), [rows]);

  // ---- Cell edit guard ----
  const { cancelEditRef, captureEditSnapshot } = useCellEditGuard({
    rows: rawRows,
    rowsPath,
    onUpdate,
    containerRef: containerRef as React.RefObject<HTMLElement>,
    onAfterRevert,
  });

  // ---- Hover insert bar ----
  const hoverInsert = useHoverInsertBar(
    containerRef as React.RefObject<HTMLElement>,
    hoverRowSelector ?? ''
  );

  // ---- Clamp selection when data changes ----
  const extraDeps = clampDeps ?? [];
  useEffect(() => {
    if (!isActive || rows.length === 0) {
      setSelectedRowId(null);
      setActiveCellState({ rowId: null, key: firstColumn });
      return;
    }

    setSelectedRowId((prev) => {
      if (!prev || !rows.some((r) => r.rowId === prev)) {
        const idx = Math.min(Math.max(0, lastKnownSelectedIndexRef.current), rows.length - 1);
        return rows[idx]?.rowId ?? null;
      }
      return prev;
    });

    setActiveCellState((prev) => {
      const exists = rows.some((r) => r.rowId === prev.rowId);
      const idx = Math.min(Math.max(0, lastKnownSelectedIndexRef.current), rows.length - 1);
      const rowId = exists ? prev.rowId : (rows[idx]?.rowId ?? null);
      const key = (columnOrder as readonly string[]).includes(prev.key) ? prev.key : firstColumn;
      if (prev.rowId === rowId && prev.key === key) {
        return prev;
      }
      return { rowId, key };
    });
  }, [rows, firstColumn, isActive, ...extraDeps]);

  // ---- Convenience setters mapped from index to rowId ----
  const setSelectedFieldIndex = useCallback(
    (idx: number | ((prev: number) => number)) => {
      if (typeof idx === 'function') {
        setSelectedRowId((prevId) => {
          const prevIdx = prevId ? rows.findIndex((r) => r.rowId === prevId) : -1;
          const nextIdx = idx(prevIdx);
          const row = rows[nextIdx];
          return row ? row.rowId : null;
        });
      } else {
        const row = rows[idx];
        setSelectedRowId(row ? row.rowId : null);
      }
    },
    [rows]
  );

  const setHoveredFieldIndex = useCallback(
    (idx: number | null | ((prev: number | null) => number | null)) => {
      if (typeof idx === 'function') {
        setHoveredRowId((prevId) => {
          const prevIdx = prevId ? rows.findIndex((r) => r.rowId === prevId) : null;
          const nextIdx = idx(prevIdx);
          if (nextIdx === null || nextIdx === undefined) {
            return null;
          }
          const row = rows[nextIdx];
          return row ? row.rowId : null;
        });
      } else {
        if (idx === null || idx === undefined) {
          setHoveredRowId(null);
        } else {
          const row = rows[idx];
          setHoveredRowId(row ? row.rowId : null);
        }
      }
    },
    [rows]
  );

  // ---- Convenience: select a row ----
  const selectRow = useCallback(
    (idx: number, key?: TColumnKey) => {
      const row = rows[idx];
      if (!row) {
        return;
      }
      setSelectedRowId(row.rowId);
      setHoveredRowId(row.rowId);
      if (key) {
        setActiveCellState({ rowId: row.rowId, key });
      } else {
        setActiveCellState((prev) => ({ rowId: row.rowId, key: prev.key }));
      }
    },
    [rows]
  );

  // ---- Focus a cell's editor input ----
  const focusCellEditor = useCallback(
    (rowId: string, key: TColumnKey) => {
      window.setTimeout(() => {
        const row = document.querySelector(`tr[${rowSelectorAttr}="${rowId}"]`);
        const editor = row?.querySelector(`[data-edit-key="${key}"]`) as HTMLElement | null;
        editor?.focus?.();
      }, 0);
    },
    [rowSelectorAttr]
  );

  // ---- Table navigation ----
  const rowIds = useMemo(() => rows.map((r) => r.rowId), [rows]);

  useTableNavigation<TColumnKey>({
    activeCell: activeCellState,
    setActiveCell: (cell) => {
      setActiveCellState(cell);
      if (cell.rowId) {
        setSelectedRowId(cell.rowId);
        setHoveredRowId(cell.rowId);
      }
    },
    rowIds,
    columnOrder: [...columnOrder],
    containerRef: containerRef as React.RefObject<HTMLElement>,
    onEdit: (rowId, key) => {
      setSelectedRowId(rowId);
      setHoveredRowId(rowId);
      setActiveCellState({ rowId, key });
      focusCellEditor(rowId, key);
    },
    onDelete: onDelete
      ? (rowId) => {
          onDelete(rowId);
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

  const handleMouseEnter = useCallback(
    (idx: number) => {
      const row = rows[idx];
      if (row) {
        setHoveredRowId(row.rowId);
      }
    },
    [rows]
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredRowId(null);
  }, []);

  return {
    // Selection by rowId
    selectedRowId,
    setSelectedRowId,
    hoveredRowId,
    setHoveredRowId,
    activeCell,
    setActiveCell: setActiveCellState,

    // Derived indices
    selectedIndex,
    hoveredIndex,

    // Index-based wrappers
    setSelectedFieldIndex,
    setHoveredFieldIndex,

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
