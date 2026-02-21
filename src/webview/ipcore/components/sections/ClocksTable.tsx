import React, { useRef } from 'react';
import type { YamlUpdateHandler } from '../../../types/editor';
import { EditableTable, FormField, SelectField } from '../../../shared/components';
import { displayDirection } from '../../../shared/utils/formatters';
import { validateVhdlIdentifier, validateUniqueName } from '../../../shared/utils/validation';
import { useTableEditing } from '../../../hooks/useTableEditing';

interface Clock {
  name: string; // Physical port name
  logicalName?: string; // Standard logical name (CLK)
  frequency?: string;
  direction?: string;
}

interface BusInterface {
  name: string;
  associatedClock?: string;
}

interface ClocksTableProps {
  clocks: unknown[];
  busInterfaces?: unknown[];
  onUpdate: YamlUpdateHandler;
}

const createEmptyClock = (): Clock => ({
  name: '',
  logicalName: 'CLK',
  frequency: '',
  direction: 'input',
});

// Normalize direction from in/out to input/output
const normalizeClock = (clock: Clock): Clock => {
  return { ...clock, direction: displayDirection(clock.direction, 'input') };
};

const COLUMN_KEYS = ['name', 'logicalName', 'frequency', 'direction', 'usedBy'];
const TABLE_COLUMNS = [
  { key: 'name', header: 'Physical Name' },
  { key: 'logicalName', header: 'Logical Name' },
  { key: 'frequency', header: 'Frequency' },
  { key: 'direction', header: 'Direction' },
  { key: 'usedBy', header: 'Used By' },
  { key: 'actions', header: 'Actions', align: 'right' as const },
];
const KEYBOARD_HINT = '• h/j/k/l: navigate • e: edit • d: delete • o: add';

// Helper to find which interfaces use a clock
const getUsedByInterfaces = (clockName: string, busInterfaces: BusInterface[]): string[] => {
  return busInterfaces.filter((bus) => bus.associatedClock === clockName).map((bus) => bus.name);
};

/**
 * Editable table for IP Core clocks
 * Supports vim-style keyboard navigation:
 * - j/k or Arrow Up/Down: Navigate rows
 * - h/l or Arrow Left/Right: Navigate columns
 * - Enter or 'e': Edit selected cell
 * - 'd' or Delete: Delete selected row
 * - 'o': Add new row
 * - Escape: Cancel editing
 */
export const ClocksTable: React.FC<ClocksTableProps> = ({
  clocks: rawClocks,
  busInterfaces: rawBusInterfaces = [],
  onUpdate,
}) => {
  const clocks = rawClocks as Clock[];
  const busInterfaces = rawBusInterfaces as BusInterface[];
  const containerRef = useRef<HTMLDivElement>(null);
  const {
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
  } = useTableEditing<Clock, (typeof COLUMN_KEYS)[number]>({
    rows: clocks,
    columnKeys: COLUMN_KEYS,
    containerRef,
    createEmptyDraft: createEmptyClock,
    normalizeDraftForEdit: normalizeClock,
    onCommit: (updated) => onUpdate(['clocks'], updated),
  });

  const existingNames = clocks.map((c) => c.name).filter((_, i) => i !== editingIndex);
  const nameError =
    validateVhdlIdentifier(draft.name) ?? validateUniqueName(draft.name, existingNames);
  const canSave = !nameError;

  const renderEditRow = (isNew: boolean) => (
    <tr
      style={{
        background: 'var(--vscode-list-activeSelectionBackground)',
        borderBottom: '1px solid var(--vscode-panel-border)',
      }}
      data-row-idx={editingIndex ?? clocks.length}
    >
      <td className="px-4 py-3">
        <FormField
          label=""
          value={draft.name}
          onChange={(v: string) => setDraft({ ...draft, name: v })}
          error={nameError ?? undefined}
          placeholder="i_clk_sys"
          required
          data-edit-key="name"
          onSave={canSave ? handleSave : undefined}
          onCancel={handleCancel}
        />
      </td>
      <td className="px-4 py-3">
        <FormField
          label=""
          value={draft.logicalName ?? 'CLK'}
          onChange={(v: string) => setDraft({ ...draft, logicalName: v })}
          placeholder="CLK"
          data-edit-key="logicalName"
          onSave={canSave ? handleSave : undefined}
          onCancel={handleCancel}
        />
      </td>
      <td className="px-4 py-3">
        <FormField
          label=""
          value={draft.frequency ?? ''}
          onChange={(v: string) => setDraft({ ...draft, frequency: v })}
          placeholder="100 MHz"
          data-edit-key="frequency"
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
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="px-3 py-1 rounded text-xs font-medium"
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
            className="px-3 py-1 rounded text-xs font-medium"
            style={{
              background: 'var(--vscode-button-secondaryBackground)',
              color: 'var(--vscode-button-foreground)',
            }}
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );

  return (
    <EditableTable
      title="Clocks"
      rows={clocks}
      rowLabelSingular="clock"
      keyboardHint={KEYBOARD_HINT}
      addButtonLabel="Add Clock"
      onAdd={handleAdd}
      disableAdd={isAdding || editingIndex !== null}
      columns={TABLE_COLUMNS}
      editingIndex={editingIndex}
      isAdding={isAdding}
      renderEditRow={renderEditRow}
      renderDisplayRow={(clock, index) => {
        const rowProps = getRowProps(index);
        const usedBy = getUsedByInterfaces(clock.name, busInterfaces);
        return (
          <tr key={index} {...rowProps} onDoubleClick={() => handleEdit(index)}>
            <td className="px-4 py-3 text-sm font-mono" {...getCellProps(index, 'name')}>
              {clock.name}
            </td>
            <td className="px-4 py-3 text-sm font-mono" {...getCellProps(index, 'logicalName')}>
              {clock.logicalName ?? 'CLK'}
            </td>
            <td className="px-4 py-3 text-sm" {...getCellProps(index, 'frequency')}>
              {clock.frequency ?? '—'}
            </td>
            <td className="px-4 py-3 text-sm" {...getCellProps(index, 'direction')}>
              {displayDirection(clock.direction)}
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
              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleEdit(index);
                  }}
                  disabled={isAdding || editingIndex !== null}
                  className="p-1 rounded"
                  style={{
                    opacity: isAdding || editingIndex !== null ? 0.3 : 1,
                  }}
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
                  className="p-1 rounded"
                  style={{
                    color: 'var(--vscode-errorForeground)',
                    opacity: isAdding || editingIndex !== null ? 0.3 : 1,
                  }}
                  title="Delete (d)"
                >
                  <span className="codicon codicon-trash"></span>
                </button>
              </div>
            </td>
          </tr>
        );
      }}
      emptyMessage={'No clocks defined. Press \'o\' or click "Add Clock" to create one.'}
      emptyColSpan={6}
      containerRef={containerRef}
    />
  );
};
