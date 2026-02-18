import React, { useRef } from "react";
import { FormField, SelectField } from "../../../shared/components";
import {
  validateVhdlIdentifier,
  validateUniqueName,
} from "../../../shared/utils/validation";
import { useVimTableNavigation } from "../../hooks/useVimTableNavigation";

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
  clocks: Clock[];
  busInterfaces?: BusInterface[];
  onUpdate: (path: Array<string | number>, value: any) => void;
}

const createEmptyClock = (): Clock => ({
  name: "",
  logicalName: "CLK",
  frequency: "",
  direction: "input",
});

// Normalize direction from in/out to input/output
const normalizeClock = (clock: Clock): Clock => {
  const dirMap: { [key: string]: string } = {
    in: "input",
    out: "output",
    input: "input",
    output: "output",
  };
  return { ...clock, direction: dirMap[clock.direction || "input"] || "input" };
};

// Helper to display normalized direction
const displayDirection = (dir?: string): string => {
  const dirMap: { [key: string]: string } = {
    in: "input",
    out: "output",
    input: "input",
    output: "output",
  };
  return dirMap[dir || "input"] || "input";
};

const COLUMN_KEYS = ["name", "logicalName", "frequency", "direction", "usedBy"];

// Helper to find which interfaces use a clock
const getUsedByInterfaces = (
  clockName: string,
  busInterfaces: BusInterface[],
): string[] => {
  return busInterfaces
    .filter((bus) => bus.associatedClock === clockName)
    .map((bus) => bus.name);
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
  clocks,
  busInterfaces = [],
  onUpdate,
}) => {
  const {
    selectedIndex,
    activeColumn,
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
  } = useVimTableNavigation<Clock>({
    items: clocks,
    onUpdate,
    dataKey: "clocks",
    createEmptyItem: createEmptyClock,
    normalizeItem: normalizeClock,
    columnKeys: COLUMN_KEYS,
  });

  const existingNames = clocks
    .map((c) => c.name)
    .filter((_, i) => i !== editingIndex);
  const nameError =
    validateVhdlIdentifier(draft.name) ||
    validateUniqueName(draft.name, existingNames);
  const canSave = !nameError;

  const renderEditRow = (isNew: boolean) => (
    <tr
      style={{
        background: "var(--vscode-list-activeSelectionBackground)",
        borderBottom: "1px solid var(--vscode-panel-border)",
      }}
      data-row-idx={editingIndex ?? clocks.length}
    >
      <td className="px-4 py-3">
        <FormField
          label=""
          value={draft.name}
          onChange={(v: string) => setDraft({ ...draft, name: v })}
          error={nameError || undefined}
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
          value={draft.logicalName || "CLK"}
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
          value={draft.frequency || ""}
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
          value={draft.direction || "input"}
          options={[
            { value: "input", label: "input" },
            { value: "output", label: "output" },
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
                ? "var(--vscode-button-background)"
                : "var(--vscode-button-secondaryBackground)",
              color: "var(--vscode-button-foreground)",
              opacity: canSave ? 1 : 0.5,
            }}
          >
            {isNew ? "Add" : "Save"}
          </button>
          <button
            onClick={handleCancel}
            className="px-3 py-1 rounded text-xs font-medium"
            style={{
              background: "var(--vscode-button-secondaryBackground)",
              color: "var(--vscode-button-foreground)",
            }}
          >
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );

  return (
    <div ref={containerRef} className="p-6 space-y-4 outline-none" tabIndex={0}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-medium">Clocks</h2>
          <p className="text-sm mt-1" style={{ opacity: 0.7 }}>
            {clocks.length} clock{clocks.length !== 1 ? "s" : ""} •
            <span className="ml-2 text-xs font-mono" style={{ opacity: 0.5 }}>
              h/j/k/l: navigate • e: edit • d: delete • o: add
            </span>
          </p>
        </div>
        <button
          onClick={handleAdd}
          disabled={isAdding || editingIndex !== null}
          className="px-4 py-2 rounded text-sm font-medium flex items-center gap-2"
          style={{
            background:
              isAdding || editingIndex !== null
                ? "var(--vscode-button-secondaryBackground)"
                : "var(--vscode-button-background)",
            color: "var(--vscode-button-foreground)",
            opacity: isAdding || editingIndex !== null ? 0.5 : 1,
          }}
        >
          <span className="codicon codicon-add"></span>
          Add Clock
        </button>
      </div>

      <div
        className="rounded overflow-hidden"
        style={{ border: "1px solid var(--vscode-panel-border)" }}
      >
        <table className="w-full">
          <thead>
            <tr
              style={{
                background: "var(--vscode-editor-background)",
                borderBottom: "1px solid var(--vscode-panel-border)",
              }}
            >
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase opacity-70">
                Physical Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase opacity-70">
                Logical Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase opacity-70">
                Frequency
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase opacity-70">
                Direction
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase opacity-70">
                Used By
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase opacity-70">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {clocks.map((clock, index) => {
              if (editingIndex === index) {
                return (
                  <React.Fragment key={index}>
                    {renderEditRow(false)}
                  </React.Fragment>
                );
              }

              const rowProps = getRowProps(index);
              const usedBy = getUsedByInterfaces(clock.name, busInterfaces);
              return (
                <tr
                  key={index}
                  {...rowProps}
                  onDoubleClick={() => handleEdit(index)}
                >
                  <td
                    className="px-4 py-3 text-sm font-mono"
                    {...getCellProps(index, "name")}
                  >
                    {clock.name}
                  </td>
                  <td
                    className="px-4 py-3 text-sm font-mono"
                    {...getCellProps(index, "logicalName")}
                  >
                    {clock.logicalName || "CLK"}
                  </td>
                  <td
                    className="px-4 py-3 text-sm"
                    {...getCellProps(index, "frequency")}
                  >
                    {clock.frequency || "—"}
                  </td>
                  <td
                    className="px-4 py-3 text-sm"
                    {...getCellProps(index, "direction")}
                  >
                    {displayDirection(clock.direction)}
                  </td>
                  <td
                    className="px-4 py-3 text-sm"
                    {...getCellProps(index, "usedBy")}
                  >
                    {usedBy.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {usedBy.map((name, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 rounded text-xs font-mono"
                            style={{
                              background: "var(--vscode-badge-background)",
                              color: "var(--vscode-badge-foreground)",
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
                          color: "var(--vscode-errorForeground)",
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
            })}

            {isAdding && renderEditRow(true)}

            {clocks.length === 0 && !isAdding && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm"
                  style={{ opacity: 0.6 }}
                >
                  No clocks defined. Press 'o' or click "Add Clock" to create
                  one.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
