import React, { useCallback, useEffect } from 'react';
import { focusContainer } from '../shared/utils/focus';
import { useTableNavigation } from './useTableNavigation';

interface UseTableEditingOptions<T, TColumnKey extends string> {
  rows: T[];
  columnKeys: readonly TColumnKey[];
  containerRef: React.RefObject<HTMLDivElement>;
  createEmptyDraft: () => T;
  normalizeDraftForEdit?: (row: T) => T;
  onCommit: (rows: T[]) => void;
}

interface UseTableEditingResult<T, TColumnKey extends string> {
  selectedIndex: number;
  setSelectedIndex: React.Dispatch<React.SetStateAction<number>>;
  activeColumn: TColumnKey;
  setActiveColumn: React.Dispatch<React.SetStateAction<TColumnKey>>;
  editingIndex: number | null;
  isAdding: boolean;
  draft: T;
  setDraft: React.Dispatch<React.SetStateAction<T>>;
  handleAdd: () => void;
  handleEdit: (index: number) => void;
  handleSave: () => void;
  handleCancel: () => void;
  handleDelete: (index: number) => void;
  getRowProps: (index: number) => {
    tabIndex: number;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onClick: () => void;
    style: React.CSSProperties;
    'data-row-idx': number;
  };
  getCellProps: (
    rowIndex: number,
    columnKey: TColumnKey
  ) => {
    'data-col-key': TColumnKey;
    onClick: (e: React.MouseEvent) => void;
    style: React.CSSProperties;
  };
}

export const useTableEditing = <T, TColumnKey extends string>({
  rows,
  columnKeys,
  containerRef,
  createEmptyDraft,
  normalizeDraftForEdit,
  onCommit,
}: UseTableEditingOptions<T, TColumnKey>): UseTableEditingResult<T, TColumnKey> => {
  const firstColumn = React.useMemo(() => {
    if (columnKeys.length === 0) {
      throw new Error('useTableEditing requires at least one column key');
    }
    return columnKeys[0];
  }, [columnKeys]);

  const [selectedIndex, setSelectedIndex] = React.useState(0);
  const [activeColumn, setActiveColumn] = React.useState<TColumnKey>(firstColumn);
  const [editingIndex, setEditingIndex] = React.useState<number | null>(null);
  const [isAdding, setIsAdding] = React.useState(false);
  const [draft, setDraft] = React.useState<T>(createEmptyDraft);

  const resetDraft = useCallback(() => {
    setDraft(createEmptyDraft());
  }, [createEmptyDraft]);

  const handleAdd = useCallback(() => {
    setIsAdding(true);
    resetDraft();
  }, [resetDraft]);

  const handleEdit = useCallback(
    (index: number) => {
      setEditingIndex(index);
      const row = rows[index];
      setDraft(normalizeDraftForEdit ? normalizeDraftForEdit(row) : row);
    },
    [rows, normalizeDraftForEdit]
  );

  const handleSave = useCallback(() => {
    if (isAdding) {
      onCommit([...rows, draft]);
      setSelectedIndex(rows.length);
    } else if (editingIndex !== null) {
      const updated = [...rows];
      updated[editingIndex] = draft;
      onCommit(updated);
    }

    setIsAdding(false);
    setEditingIndex(null);
    resetDraft();
    focusContainer(containerRef);
  }, [isAdding, editingIndex, draft, onCommit, rows, resetDraft, containerRef]);

  const handleCancel = useCallback(() => {
    setIsAdding(false);
    setEditingIndex(null);
    resetDraft();
    focusContainer(containerRef);
  }, [resetDraft, containerRef]);

  const handleDelete = useCallback(
    (index: number) => {
      const updated = rows.filter((_, i) => i !== index);
      onCommit(updated);
      if (selectedIndex >= updated.length) {
        setSelectedIndex(Math.max(0, updated.length - 1));
      }
    },
    [rows, onCommit, selectedIndex]
  );

  useTableNavigation<TColumnKey>({
    activeCell: {
      rowIndex: selectedIndex,
      key: activeColumn || firstColumn,
    },
    setActiveCell: (cell) => {
      setSelectedIndex(cell.rowIndex);
      setActiveColumn(cell.key);
    },
    rowCount: rows.length,
    columnOrder: [...columnKeys],
    containerRef,
    onEdit: (rowIndex) => {
      if (rows.length > 0 && rowIndex >= 0 && rowIndex < rows.length) {
        handleEdit(rowIndex);
      }
    },
    onDelete: (rowIndex) => {
      if (rows.length > 0 && rowIndex >= 0 && rowIndex < rows.length) {
        handleDelete(rowIndex);
      }
    },
    onInsertAfter: handleAdd,
    isActive: editingIndex === null && !isAdding,
  });

  useEffect(() => {
    if (editingIndex === null && !isAdding) {
      return;
    }

    const timerId = setTimeout(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const targetRowIdx = isAdding ? rows.length : editingIndex;
      const row = container.querySelector(`tr[data-row-idx="${String(targetRowIdx)}"]`);
      if (!row) {
        return;
      }
      const targetColumn = isAdding ? columnKeys[0] : activeColumn;
      const cell = row.querySelector<HTMLElement>(`[data-edit-key="${targetColumn}"]`);
      cell?.focus();
    }, 0);

    return () => clearTimeout(timerId);
  }, [editingIndex, isAdding, activeColumn, rows.length, columnKeys, containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (editingIndex !== null || isAdding)) {
        e.preventDefault();
        handleCancel();
      }
    };

    container.addEventListener('keydown', handleEscape);
    return () => container.removeEventListener('keydown', handleEscape);
  }, [editingIndex, isAdding, handleCancel, containerRef]);

  const getRowProps = useCallback(
    (index: number) => ({
      tabIndex: 0,
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && editingIndex === null && !isAdding) {
          e.preventDefault();
          handleEdit(index);
        }
      },
      onClick: () => {
        setSelectedIndex(index);
      },
      style: {
        background:
          selectedIndex === index
            ? 'var(--vscode-list-activeSelectionBackground)'
            : 'var(--vscode-editor-background)',
        borderBottom: '1px solid var(--vscode-panel-border)',
        cursor: 'pointer',
      } as React.CSSProperties,
      'data-row-idx': index,
    }),
    [selectedIndex, editingIndex, isAdding, handleEdit]
  );

  const getCellProps = useCallback(
    (rowIndex: number, columnKey: TColumnKey) => ({
      'data-col-key': columnKey,
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedIndex(rowIndex);
        setActiveColumn(columnKey);
      },
      style: {
        outline:
          selectedIndex === rowIndex && activeColumn === columnKey
            ? '2px solid var(--vscode-focusBorder)'
            : 'none',
        outlineOffset: '-2px',
      } as React.CSSProperties,
    }),
    [selectedIndex, activeColumn]
  );

  return {
    selectedIndex,
    setSelectedIndex,
    activeColumn,
    setActiveColumn,
    editingIndex,
    isAdding,
    draft,
    setDraft,
    handleAdd,
    handleEdit,
    handleSave,
    handleCancel,
    handleDelete,
    getRowProps,
    getCellProps,
  };
};
