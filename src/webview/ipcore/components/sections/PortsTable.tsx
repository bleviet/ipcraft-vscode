import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { YamlUpdateHandler } from '../../../types/editor';
import { FormField, SelectField, NumberField } from '../../../shared/components';
import { focusContainer } from '../../../shared/utils/focus';
import { displayDirection } from '../../../shared/utils/formatters';
import { validateVhdlIdentifier, validateUniqueName } from '../../../shared/utils/validation';
import { useTableNavigation } from '../../../hooks/useTableNavigation';

interface Port {
  name: string;
  direction: string;
  width?: number;
}

interface PortsTableProps {
  ports: unknown[];
  onUpdate: YamlUpdateHandler;
}

const createEmptyPort = (): Port => ({
  name: '',
  direction: 'input',
  width: 1,
});

const normalizePort = (port: Port): Port => {
  const normalizedDirection = displayDirection(port.direction, 'input');
  return {
    ...port,
    direction:
      normalizedDirection === 'input' ||
      normalizedDirection === 'output' ||
      normalizedDirection === 'inout'
        ? normalizedDirection
        : 'input',
  };
};

const COLUMN_KEYS = ['name', 'direction', 'width'];

/**
 * Editable table for IP Core ports
 * Vim-style: h/j/k/l navigate cells, e edit, d delete, o add
 */
export const PortsTable: React.FC<PortsTableProps> = ({ ports: rawPorts, onUpdate }) => {
  const ports = rawPorts as Port[];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [activeColumn, setActiveColumn] = useState(COLUMN_KEYS[0] || '');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState<Port>(createEmptyPort());
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
      const targetRowIdx = isAdding ? ports.length : editingIndex;
      const row = container.querySelector(`tr[data-row-idx="${String(targetRowIdx)}"]`);
      if (!row) {
        return;
      }
      const targetColumn = isAdding ? COLUMN_KEYS[0] : activeColumn;
      const cell = row.querySelector<HTMLElement>(`[data-edit-key="${targetColumn}"]`);
      cell?.focus();
    }, 0);

    return () => clearTimeout(timerId);
  }, [editingIndex, isAdding, activeColumn, ports.length]);

  const handleAdd = useCallback(() => {
    setIsAdding(true);
    setDraft(createEmptyPort());
  }, []);

  const handleEdit = useCallback(
    (index: number) => {
      setEditingIndex(index);
      setDraft(normalizePort(ports[index]));
    },
    [ports]
  );

  const handleSave = useCallback(() => {
    if (isAdding) {
      onUpdate(['ports'], [...ports, draft]);
      setSelectedIndex(ports.length);
    } else if (editingIndex !== null) {
      const updated = [...ports];
      updated[editingIndex] = draft;
      onUpdate(['ports'], updated);
    }

    setIsAdding(false);
    setEditingIndex(null);
    setDraft(createEmptyPort());
    focusContainer(containerRef);
  }, [isAdding, editingIndex, draft, onUpdate, ports]);

  const handleCancel = useCallback(() => {
    setIsAdding(false);
    setEditingIndex(null);
    setDraft(createEmptyPort());
    focusContainer(containerRef);
  }, []);

  const handleDelete = useCallback(
    (index: number) => {
      const updated = ports.filter((_, i) => i !== index);
      onUpdate(['ports'], updated);
      if (selectedIndex >= updated.length) {
        setSelectedIndex(Math.max(0, updated.length - 1));
      }
    },
    [ports, onUpdate, selectedIndex]
  );

  useTableNavigation<string>({
    activeCell: { rowIndex: selectedIndex, key: activeColumn || COLUMN_KEYS[0] || '' },
    setActiveCell: (cell) => {
      setSelectedIndex(cell.rowIndex);
      setActiveColumn(cell.key);
    },
    rowCount: ports.length,
    columnOrder: COLUMN_KEYS,
    containerRef,
    onEdit: (rowIndex) => {
      if (ports.length > 0 && rowIndex >= 0 && rowIndex < ports.length) {
        handleEdit(rowIndex);
      }
    },
    onDelete: (rowIndex) => {
      if (ports.length > 0 && rowIndex >= 0 && rowIndex < ports.length) {
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

  const existingNames = ports.map((p) => p.name).filter((_, i) => i !== editingIndex);
  const nameError =
    validateVhdlIdentifier(draft.name) ?? validateUniqueName(draft.name, existingNames);
  const canSave = !nameError;

  const renderEditRow = (isNew: boolean) => (
    <tr
      style={{
        background: 'var(--vscode-list-activeSelectionBackground)',
        borderBottom: '1px solid var(--vscode-panel-border)',
      }}
      data-row-idx={editingIndex ?? ports.length}
    >
      <td className="px-4 py-3">
        <FormField
          label=""
          value={draft.name}
          onChange={(v: string) => setDraft({ ...draft, name: v })}
          error={nameError ?? undefined}
          placeholder="port_name"
          required
          data-edit-key="name"
          onSave={canSave ? handleSave : undefined}
          onCancel={handleCancel}
        />
      </td>
      <td className="px-4 py-3">
        <SelectField
          label=""
          value={draft.direction}
          options={[
            { value: 'input', label: 'input' },
            { value: 'output', label: 'output' },
            { value: 'inout', label: 'inout' },
          ]}
          onChange={(v: string) => setDraft({ ...draft, direction: v })}
          data-edit-key="direction"
          onSave={canSave ? handleSave : undefined}
          onCancel={handleCancel}
        />
      </td>
      <td className="px-4 py-3">
        <NumberField
          label=""
          value={draft.width ?? 1}
          onChange={(v: number) => setDraft({ ...draft, width: v })}
          min={1}
          data-edit-key="width"
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
    <div ref={containerRef} className="p-6 space-y-4 outline-none" tabIndex={0}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-medium">Ports</h2>
          <p className="text-sm mt-1" style={{ opacity: 0.7 }}>
            {ports.length} port{ports.length !== 1 ? 's' : ''} •
            <span className="ml-2 text-xs font-mono" style={{ opacity: 0.5 }}>
              h/j/k/l: navigate • e: edit • d: delete • o: add
            </span>
          </p>
        </div>
        <button
          onClick={handleAdd}
          disabled={isAdding || editingIndex !== null}
          className="px-4 py-2 rounded text-sm flex items-center gap-2"
          style={{
            background:
              isAdding || editingIndex !== null
                ? 'var(--vscode-button-secondaryBackground)'
                : 'var(--vscode-button-background)',
            color: 'var(--vscode-button-foreground)',
            opacity: isAdding || editingIndex !== null ? 0.5 : 1,
          }}
        >
          <span className="codicon codicon-add"></span>Add Port
        </button>
      </div>

      <div
        className="rounded overflow-hidden"
        style={{ border: '1px solid var(--vscode-panel-border)' }}
      >
        <table className="w-full">
          <thead>
            <tr
              style={{
                background: 'var(--vscode-editor-background)',
                borderBottom: '1px solid var(--vscode-panel-border)',
              }}
            >
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase opacity-70">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase opacity-70">
                Direction
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase opacity-70">
                Width
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase opacity-70">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {ports.map((port, index) => {
              if (editingIndex === index) {
                return <React.Fragment key={index}>{renderEditRow(false)}</React.Fragment>;
              }
              const rowProps = getRowProps(index);
              return (
                <tr key={index} {...rowProps} onDoubleClick={() => handleEdit(index)}>
                  <td className="px-4 py-3 text-sm font-mono" {...getCellProps(index, 'name')}>
                    {port.name}
                  </td>
                  <td className="px-4 py-3 text-sm" {...getCellProps(index, 'direction')}>
                    {displayDirection(port.direction)}
                  </td>
                  <td className="px-4 py-3 text-sm" {...getCellProps(index, 'width')}>
                    {port.width ?? 1}
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
            })}
            {isAdding && renderEditRow(true)}
            {ports.length === 0 && !isAdding && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm" style={{ opacity: 0.6 }}>
                  No ports defined. Press 'o' or click "Add Port".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
