import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Vim-style table navigation hook for IP Core tables
 * Supports:
 * - j/k or Arrow Up/Down for row navigation
 * - h/l or Arrow Left/Right for column navigation
 * - Enter or 'e' for editing active cell
 * - Escape for cancel
 * - 'd' or Delete for deletion
 * - 'o' for insert after (add new row)
 */
export interface UseVimTableNavigationProps<T> {
  items: T[];
  onUpdate: (path: Array<string | number>, value: T[]) => void;
  dataKey: string; // e.g., 'clocks', 'resets', 'ports'
  createEmptyItem: () => T;
  normalizeItem?: (item: T) => T; // For value normalization on edit
  /** Column keys for navigation order */
  columnKeys: string[];
}

export interface UseVimTableNavigationReturn<T> {
  /** Currently selected row index */
  selectedIndex: number;
  /** Set selected row index */
  setSelectedIndex: (idx: number) => void;
  /** Currently active column key */
  activeColumn: string;
  /** Set active column */
  setActiveColumn: (key: string) => void;
  /** Whether currently editing a row */
  editingIndex: number | null;
  /** Whether adding a new row */
  isAdding: boolean;
  /** Draft item being edited */
  draft: T;
  /** Update draft */
  setDraft: React.Dispatch<React.SetStateAction<T>>;
  /** Start editing a row */
  handleEdit: (index: number) => void;
  /** Start adding a new row */
  handleAdd: () => void;
  /** Save current edit */
  handleSave: () => void;
  /** Cancel editing */
  handleCancel: () => void;
  /** Delete a row */
  handleDelete: (index: number) => void;
  /** Container ref for key event handling */
  containerRef: React.RefObject<HTMLDivElement>;
  /** Get row props for keyboard navigation */
  getRowProps: (index: number) => {
    tabIndex: number;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onClick: () => void;
    style: React.CSSProperties;
    'data-row-idx': number;
  };
  /** Get cell props for column-level navigation */
  getCellProps: (
    rowIndex: number,
    columnKey: string
  ) => {
    'data-col-key': string;
    onClick: (e: React.MouseEvent) => void;
    style: React.CSSProperties;
  };
  /** Focus the editor for the active cell */
  focusActiveCell: () => void;
}

export function useVimTableNavigation<T>({
  items,
  onUpdate,
  dataKey,
  createEmptyItem,
  normalizeItem,
  columnKeys,
}: UseVimTableNavigationProps<T>): UseVimTableNavigationReturn<T> {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeColumn, setActiveColumn] = useState(columnKeys[0] || '');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState<T>(createEmptyItem());
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus the editor element for the active cell
  const focusActiveCell = useCallback(() => {
    requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const row = container.querySelector(`tr[data-row-idx="${selectedIndex}"]`);
      if (!row) {
        return;
      }
      const cell = row.querySelector(`[data-edit-key="${activeColumn}"]`) as HTMLElement;
      if (cell) {
        cell.focus();
      }
    });
  }, [selectedIndex, activeColumn]);

  // Scroll to visible
  const scrollToCell = useCallback((rowIndex: number, colKey: string) => {
    requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const row = container.querySelector(`tr[data-row-idx="${rowIndex}"]`) as HTMLElement;
      if (row) {
        row.scrollIntoView({ block: rowIndex === 0 ? 'center' : 'nearest' });
      }
      const cell = row?.querySelector(`td[data-col-key="${colKey}"]`) as HTMLElement;
      if (cell) {
        cell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    });
  }, []);

  // Auto-focus the active cell's editor when entering edit mode OR when adding a new item
  useEffect(() => {
    if (editingIndex !== null || isAdding) {
      // Use setTimeout to ensure React has rendered the edit row
      const timerId = setTimeout(() => {
        const container = containerRef.current;
        if (!container) {
          return;
        }
        // For adding, the new row is at the end (items.length)
        const targetRowIdx = isAdding ? items.length : editingIndex;
        const row = container.querySelector(`tr[data-row-idx="${targetRowIdx}"]`);
        if (!row) {
          return;
        }
        // For adding, always focus the "name" field (first column); for editing, focus the active column
        const targetColumn = isAdding ? columnKeys[0] : activeColumn;
        const cell = row.querySelector(`[data-edit-key="${targetColumn}"]`) as HTMLElement;
        if (cell) {
          cell.focus();
        }
      }, 0);
      return () => clearTimeout(timerId);
    }
  }, [editingIndex, isAdding, activeColumn, columnKeys, items.length]);

  // Handle keyboard navigation at container level
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if editing or in an input (except for Escape)
      const target = e.target as HTMLElement;
      const isTyping = target.closest(
        'input, textarea, select, [contenteditable="true"], vscode-text-field, vscode-text-area, vscode-dropdown'
      );

      if (isTyping || editingIndex !== null || isAdding) {
        // Handle Escape to cancel editing
        if (e.key === 'Escape') {
          e.preventDefault();
          handleCancel();
        }
        return;
      }

      // Skip if using Ctrl/Cmd modifiers
      if (e.ctrlKey || e.metaKey) {
        return;
      }

      const key = e.key.toLowerCase();

      // Vim key mapping
      const vimToArrow: Record<string, string> = {
        h: 'ArrowLeft',
        j: 'ArrowDown',
        k: 'ArrowUp',
        l: 'ArrowRight',
      };
      const normalizedKey = vimToArrow[key] ?? e.key;

      // Row navigation (j/k or ArrowUp/Down)
      if (normalizedKey === 'ArrowDown') {
        e.preventDefault();
        const nextRow = Math.min(selectedIndex + 1, items.length - 1);
        setSelectedIndex(nextRow);
        scrollToCell(nextRow, activeColumn);
      } else if (normalizedKey === 'ArrowUp') {
        e.preventDefault();
        const prevRow = Math.max(selectedIndex - 1, 0);
        setSelectedIndex(prevRow);
        scrollToCell(prevRow, activeColumn);
      }
      // Column navigation (h/l or ArrowLeft/Right)
      else if (normalizedKey === 'ArrowLeft') {
        e.preventDefault();
        const currentColIdx = columnKeys.indexOf(activeColumn);
        const prevColIdx = Math.max(currentColIdx - 1, 0);
        const newCol = columnKeys[prevColIdx];
        setActiveColumn(newCol);
        scrollToCell(selectedIndex, newCol);
      } else if (normalizedKey === 'ArrowRight') {
        e.preventDefault();
        const currentColIdx = columnKeys.indexOf(activeColumn);
        const nextColIdx = Math.min(currentColIdx + 1, columnKeys.length - 1);
        const newCol = columnKeys[nextColIdx];
        setActiveColumn(newCol);
        scrollToCell(selectedIndex, newCol);
      }
      // Edit active cell
      else if (key === 'e' || e.key === 'Enter') {
        e.preventDefault();
        if (items.length > 0 && selectedIndex >= 0 && selectedIndex < items.length) {
          handleEdit(selectedIndex);
          focusActiveCell();
        }
      }
      // Delete
      else if (key === 'd' || e.key === 'Delete') {
        e.preventDefault();
        if (items.length > 0 && selectedIndex >= 0 && selectedIndex < items.length) {
          handleDelete(selectedIndex);
        }
      }
      // Insert (add new row)
      else if (key === 'o') {
        e.preventDefault();
        handleAdd();
      }
      // Go to first row (gg or G with shift)
      else if (key === 'g') {
        e.preventDefault();
        if (e.shiftKey) {
          // G: go to last
          setSelectedIndex(items.length - 1);
          scrollToCell(items.length - 1, activeColumn);
        } else {
          // g: go to first
          setSelectedIndex(0);
          scrollToCell(0, activeColumn);
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [
    items.length,
    selectedIndex,
    activeColumn,
    editingIndex,
    isAdding,
    columnKeys,
    scrollToCell,
    focusActiveCell,
  ]);

  const handleAdd = useCallback(() => {
    setIsAdding(true);
    setDraft(createEmptyItem());
  }, [createEmptyItem]);

  const handleEdit = useCallback(
    (index: number) => {
      setEditingIndex(index);
      const item = items[index];
      setDraft(normalizeItem ? normalizeItem(item) : { ...item });
    },
    [items, normalizeItem]
  );

  const handleSave = useCallback(() => {
    if (isAdding) {
      onUpdate([dataKey], [...items, draft]);
      setSelectedIndex(items.length); // Select newly added row
    } else if (editingIndex !== null) {
      const updated = [...items];
      updated[editingIndex] = draft;
      onUpdate([dataKey], updated);
    }
    setIsAdding(false);
    setEditingIndex(null);
    setDraft(createEmptyItem());
    // Refocus the container so vim navigation continues to work
    setTimeout(() => containerRef.current?.focus(), 0);
  }, [isAdding, editingIndex, draft, items, onUpdate, dataKey, createEmptyItem]);

  const handleCancel = useCallback(() => {
    setIsAdding(false);
    setEditingIndex(null);
    setDraft(createEmptyItem());
    // Refocus the container so vim navigation continues to work
    setTimeout(() => containerRef.current?.focus(), 0);
  }, [createEmptyItem]);

  const handleDelete = useCallback(
    (index: number) => {
      const updated = items.filter((_, i) => i !== index);
      onUpdate([dataKey], updated);
      // Adjust selection if needed
      if (selectedIndex >= updated.length) {
        setSelectedIndex(Math.max(0, updated.length - 1));
      }
    },
    [items, onUpdate, dataKey, selectedIndex]
  );

  const getRowProps = useCallback(
    (index: number) => ({
      tabIndex: 0,
      onKeyDown: (e: React.KeyboardEvent) => {
        // Handle Enter to edit when row is focused
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
    (rowIndex: number, columnKey: string) => ({
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
    handleEdit,
    handleAdd,
    handleSave,
    handleCancel,
    handleDelete,
    containerRef,
    getRowProps,
    getCellProps,
    focusActiveCell,
  };
}
