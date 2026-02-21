import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { YamlUpdateHandler } from '../../../types/editor';
import { EditableTable, FormField, SelectField } from '../../../shared/components';
import { focusContainer } from '../../../shared/utils/focus';
import { displayDirection } from '../../../shared/utils/formatters';
import { validateVhdlIdentifier, validateUniqueName } from '../../../shared/utils/validation';
import { useTableNavigation } from '../../../hooks/useTableNavigation';

interface Reset {
  name: string; // Physical port name
  logicalName?: string; // Standard logical name (RESET/RESET_N)
  polarity: string;
  direction?: string;
}

interface BusInterface {
  name: string;
  associatedReset?: string;
}

interface ResetsTableProps {
  resets: unknown[];
  busInterfaces?: unknown[];
  onUpdate: YamlUpdateHandler;
}

const createEmptyReset = (): Reset => ({
  name: '',
  logicalName: 'RESET_N',
  polarity: 'activeLow',
  direction: 'input',
});

const normalizeReset = (reset: Reset): Reset => {
  // Normalize polarity from snake_case (active_low) to camelCase (activeLow)
  let normalizedPolarity = reset.polarity;
  if (reset.polarity === 'active_low') {
    normalizedPolarity = 'activeLow';
  } else if (reset.polarity === 'active_high') {
    normalizedPolarity = 'activeHigh';
  }
  const normalizedDirection = displayDirection(reset.direction, 'input');
  return {
    ...reset,
    polarity: normalizedPolarity,
    direction: normalizedDirection,
  };
};

const COLUMN_KEYS = ['name', 'logicalName', 'polarity', 'direction', 'usedBy'];
const TABLE_COLUMNS = [
  { key: 'name', header: 'Physical Name' },
  { key: 'logicalName', header: 'Logical Name' },
  { key: 'polarity', header: 'Polarity' },
  { key: 'direction', header: 'Direction' },
  { key: 'usedBy', header: 'Used By' },
  { key: 'actions', header: 'Actions', align: 'right' as const },
];
const KEYBOARD_HINT = '• h/j/k/l: navigate • e: edit • d: delete • o: add';

// Helper to find which interfaces use a reset
const getUsedByInterfaces = (resetName: string, busInterfaces: BusInterface[]): string[] => {
  return busInterfaces.filter((bus) => bus.associatedReset === resetName).map((bus) => bus.name);
};

/**
 * Editable table for IP Core resets
 * Vim-style: h/j/k/l navigate cells, e edit, d delete, o add
 */
export const ResetsTable: React.FC<ResetsTableProps> = ({
  resets: rawResets,
  busInterfaces: rawBusInterfaces = [],
  onUpdate,
}) => {
  const resets = rawResets as Reset[];
  const busInterfaces = rawBusInterfaces as BusInterface[];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeColumn, setActiveColumn] = useState(COLUMN_KEYS[0] || '');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState<Reset>(createEmptyReset());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingIndex === null && !isAdding) {
      return;
    }

    const timerId = setTimeout(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }
      const targetRowIdx = isAdding ? resets.length : editingIndex;
      const row = container.querySelector(`tr[data-row-idx="${String(targetRowIdx)}"]`);
      if (!row) {
        return;
      }
      const targetColumn = isAdding ? COLUMN_KEYS[0] : activeColumn;
      const cell = row.querySelector<HTMLElement>(`[data-edit-key="${targetColumn}"]`);
      cell?.focus();
    }, 0);

    return () => clearTimeout(timerId);
  }, [editingIndex, isAdding, activeColumn, resets.length]);

  const handleAdd = useCallback(() => {
    setIsAdding(true);
    setDraft(createEmptyReset());
  }, []);

  const handleEdit = useCallback(
    (index: number) => {
      setEditingIndex(index);
      setDraft(normalizeReset(resets[index]));
    },
    [resets]
  );

  const handleSave = useCallback(() => {
    if (isAdding) {
      onUpdate(['resets'], [...resets, draft]);
      setSelectedIndex(resets.length);
    } else if (editingIndex !== null) {
      const updated = [...resets];
      updated[editingIndex] = draft;
      onUpdate(['resets'], updated);
    }

    setIsAdding(false);
    setEditingIndex(null);
    setDraft(createEmptyReset());
    focusContainer(containerRef);
  }, [isAdding, editingIndex, draft, onUpdate, resets]);

  const handleCancel = useCallback(() => {
    setIsAdding(false);
    setEditingIndex(null);
    setDraft(createEmptyReset());
    focusContainer(containerRef);
  }, []);

  const handleDelete = useCallback(
    (index: number) => {
      const updated = resets.filter((_, i) => i !== index);
      onUpdate(['resets'], updated);
      if (selectedIndex >= updated.length) {
        setSelectedIndex(Math.max(0, updated.length - 1));
      }
    },
    [resets, onUpdate, selectedIndex]
  );

  useTableNavigation<string>({
    activeCell: { rowIndex: selectedIndex, key: activeColumn || COLUMN_KEYS[0] || '' },
    setActiveCell: (cell) => {
      setSelectedIndex(cell.rowIndex);
      setActiveColumn(cell.key);
    },
    rowCount: resets.length,
    columnOrder: COLUMN_KEYS,
    containerRef,
    onEdit: (rowIndex) => {
      if (resets.length > 0 && rowIndex >= 0 && rowIndex < resets.length) {
        handleEdit(rowIndex);
      }
    },
    onDelete: (rowIndex) => {
      if (resets.length > 0 && rowIndex >= 0 && rowIndex < resets.length) {
        handleDelete(rowIndex);
      }
    },
    onInsertAfter: handleAdd,
    isActive: editingIndex === null && !isAdding,
  });

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
  }, [editingIndex, isAdding, handleCancel]);

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

  const existingNames = resets.map((r) => r.name).filter((_, i) => i !== editingIndex);
  const nameError =
    validateVhdlIdentifier(draft.name) ?? validateUniqueName(draft.name, existingNames);
  const canSave = !nameError;

  const renderEditRow = (isNew: boolean) => (
    <tr
      style={{
        background: 'var(--vscode-list-activeSelectionBackground)',
        borderBottom: '1px solid var(--vscode-panel-border)',
      }}
      data-row-idx={editingIndex ?? resets.length}
    >
      <td className="px-4 py-3">
        <FormField
          label=""
          value={draft.name}
          onChange={(v: string) => setDraft({ ...draft, name: v })}
          error={nameError ?? undefined}
          placeholder="i_rst_n_sys"
          required
          data-edit-key="name"
          onSave={canSave ? handleSave : undefined}
          onCancel={handleCancel}
        />
      </td>
      <td className="px-4 py-3">
        <SelectField
          label=""
          value={draft.logicalName ?? (draft.polarity === 'activeLow' ? 'RESET_N' : 'RESET')}
          options={[
            { value: 'RESET_N', label: 'RESET_N' },
            { value: 'RESET', label: 'RESET' },
          ]}
          onChange={(v: string) =>
            setDraft({
              ...draft,
              logicalName: v,
              polarity: v === 'RESET_N' ? 'activeLow' : 'activeHigh',
            })
          }
          data-edit-key="logicalName"
          onSave={canSave ? handleSave : undefined}
          onCancel={handleCancel}
        />
      </td>
      <td className="px-4 py-3">
        <SelectField
          label=""
          value={draft.polarity}
          options={[
            { value: 'activeLow', label: 'activeLow' },
            { value: 'activeHigh', label: 'activeHigh' },
          ]}
          onChange={(v: string) =>
            setDraft({
              ...draft,
              polarity: v,
              logicalName: v === 'activeLow' ? 'RESET_N' : 'RESET',
            })
          }
          data-edit-key="polarity"
          onSave={canSave ? handleSave : undefined}
          onCancel={handleCancel}
        />
      </td>
      <td className="px-4 py-3">
        <SelectField
          label=""
          value={draft.direction ?? 'input'}
          options={[
            { value: 'input', label: 'input' },
            { value: 'output', label: 'output' },
          ]}
          onChange={(v: string) => setDraft({ ...draft, direction: v })}
          data-edit-key="direction"
          onSave={canSave ? handleSave : undefined}
          onCancel={handleCancel}
        />
      </td>
      <td className="px-4 py-3 text-right">
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="px-3 py-1 rounded text-xs mr-2"
          style={{
            background: canSave
              ? 'var(--vscode-button-background)'
              : 'var(--vscode-button-secondaryBackground)',
            color: 'var(--vscode-button-foreground)',
            opacity: canSave ? 1 : 0.5,
          }}
        >
          {isNew ? 'Add' : 'Save'}
        </button>
        <button
          onClick={handleCancel}
          className="px-3 py-1 rounded text-xs"
          style={{
            background: 'var(--vscode-button-secondaryBackground)',
            color: 'var(--vscode-button-foreground)',
          }}
        >
          Cancel
        </button>
      </td>
    </tr>
  );

  return (
    <EditableTable
      title="Resets"
      rows={resets}
      rowLabelSingular="reset"
      keyboardHint={KEYBOARD_HINT}
      addButtonLabel="Add Reset"
      onAdd={handleAdd}
      disableAdd={isAdding || editingIndex !== null}
      columns={TABLE_COLUMNS}
      editingIndex={editingIndex}
      isAdding={isAdding}
      renderEditRow={renderEditRow}
      renderDisplayRow={(reset, index) => {
        const rowProps = getRowProps(index);
        const usedBy = getUsedByInterfaces(reset.name, busInterfaces);
        return (
          <tr key={index} {...rowProps} onDoubleClick={() => handleEdit(index)}>
            <td className="px-4 py-3 text-sm font-mono" {...getCellProps(index, 'name')}>
              {reset.name}
            </td>
            <td className="px-4 py-3 text-sm font-mono" {...getCellProps(index, 'logicalName')}>
              {reset.logicalName ?? (reset.polarity === 'activeLow' ? 'RESET_N' : 'RESET')}
            </td>
            <td className="px-4 py-3 text-sm" {...getCellProps(index, 'polarity')}>
              {reset.polarity}
            </td>
            <td className="px-4 py-3 text-sm" {...getCellProps(index, 'direction')}>
              {displayDirection(reset.direction)}
            </td>
            <td className="px-4 py-3 text-sm" {...getCellProps(index, 'usedBy')}>
              {usedBy.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {usedBy.map((name, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 rounded text-xs font-mono"
                      style={{
                        background: 'var(--vscode-badge-background)',
                        color: 'var(--vscode-badge-foreground)',
                      }}
                    >
                      {name}
                    </span>
                  ))}
                </div>
              ) : (
                <span style={{ opacity: 0.5 }}>—</span>
              )}
            </td>
            <td className="px-4 py-3 text-right">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleEdit(index);
                }}
                disabled={isAdding || editingIndex !== null}
                className="p-1 mr-2"
                title="Edit (e)"
              >
                <span className="codicon codicon-edit"></span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(index);
                }}
                disabled={isAdding || editingIndex !== null}
                className="p-1"
                style={{ color: 'var(--vscode-errorForeground)' }}
                title="Delete (d)"
              >
                <span className="codicon codicon-trash"></span>
              </button>
            </td>
          </tr>
        );
      }}
      emptyMessage={'No resets defined. Press \'o\' or click "Add Reset".'}
      emptyColSpan={6}
      containerRef={containerRef}
    />
  );
};
