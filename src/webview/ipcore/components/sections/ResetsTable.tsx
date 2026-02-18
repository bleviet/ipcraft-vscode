import React from "react";
import { FormField, SelectField } from "../../../shared/components";
import {
  validateVhdlIdentifier,
  validateUniqueName,
} from "../../../shared/utils/validation";
import { useVimTableNavigation } from "../../hooks/useVimTableNavigation";

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
  resets: Reset[];
  busInterfaces?: BusInterface[];
  onUpdate: (path: Array<string | number>, value: any) => void;
}

const createEmptyReset = (): Reset => ({
  name: "",
  logicalName: "RESET_N",
  polarity: "activeLow",
  direction: "input",
});

const normalizeReset = (reset: Reset): Reset => {
  // Normalize polarity from snake_case (active_low) to camelCase (activeLow)
  let normalizedPolarity = reset.polarity;
  if (reset.polarity === "active_low") {
    normalizedPolarity = "activeLow";
  } else if (reset.polarity === "active_high") {
    normalizedPolarity = "activeHigh";
  }
  // Normalize direction from in/out to input/output
  const dirMap: { [key: string]: string } = {
    in: "input",
    out: "output",
    input: "input",
    output: "output",
  };
  const normalizedDirection = dirMap[reset.direction || "input"] || "input";
  return {
    ...reset,
    polarity: normalizedPolarity,
    direction: normalizedDirection,
  };
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

const COLUMN_KEYS = ["name", "logicalName", "polarity", "direction", "usedBy"];

// Helper to find which interfaces use a reset
const getUsedByInterfaces = (
  resetName: string,
  busInterfaces: BusInterface[],
): string[] => {
  return busInterfaces
    .filter((bus) => bus.associatedReset === resetName)
    .map((bus) => bus.name);
};

/**
 * Editable table for IP Core resets
 * Vim-style: h/j/k/l navigate cells, e edit, d delete, o add
 */
export const ResetsTable: React.FC<ResetsTableProps> = ({
  resets,
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
  } = useVimTableNavigation<Reset>({
    items: resets,
    onUpdate,
    dataKey: "resets",
    createEmptyItem: createEmptyReset,
    normalizeItem: normalizeReset,
    columnKeys: COLUMN_KEYS,
  });

  const existingNames = resets
    .map((r) => r.name)
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
      data-row-idx={editingIndex ?? resets.length}
    >
      <td className="px-4 py-3">
        <FormField
          label=""
          value={draft.name}
          onChange={(v: string) => setDraft({ ...draft, name: v })}
          error={nameError || undefined}
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
          value={
            draft.logicalName ||
            (draft.polarity === "activeLow" ? "RESET_N" : "RESET")
          }
          options={[
            { value: "RESET_N", label: "RESET_N" },
            { value: "RESET", label: "RESET" },
          ]}
          onChange={(v: string) =>
            setDraft({
              ...draft,
              logicalName: v,
              polarity: v === "RESET_N" ? "activeLow" : "activeHigh",
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
            { value: "activeLow", label: "activeLow" },
            { value: "activeHigh", label: "activeHigh" },
          ]}
          onChange={(v: string) =>
            setDraft({
              ...draft,
              polarity: v,
              logicalName: v === "activeLow" ? "RESET_N" : "RESET",
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
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="px-3 py-1 rounded text-xs mr-2"
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
          className="px-3 py-1 rounded text-xs"
          style={{
            background: "var(--vscode-button-secondaryBackground)",
            color: "var(--vscode-button-foreground)",
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
          <h2 className="text-xl font-medium">Resets</h2>
          <p className="text-sm mt-1" style={{ opacity: 0.7 }}>
            {resets.length} reset{resets.length !== 1 ? "s" : ""} •
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
                ? "var(--vscode-button-secondaryBackground)"
                : "var(--vscode-button-background)",
            color: "var(--vscode-button-foreground)",
            opacity: isAdding || editingIndex !== null ? 0.5 : 1,
          }}
        >
          <span className="codicon codicon-add"></span>Add Reset
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
                Polarity
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
            {resets.map((reset, index) => {
              if (editingIndex === index) {
                return (
                  <React.Fragment key={index}>
                    {renderEditRow(false)}
                  </React.Fragment>
                );
              }
              const rowProps = getRowProps(index);
              const usedBy = getUsedByInterfaces(reset.name, busInterfaces);
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
                    {reset.name}
                  </td>
                  <td
                    className="px-4 py-3 text-sm font-mono"
                    {...getCellProps(index, "logicalName")}
                  >
                    {reset.logicalName ||
                      (reset.polarity === "activeLow" ? "RESET_N" : "RESET")}
                  </td>
                  <td
                    className="px-4 py-3 text-sm"
                    {...getCellProps(index, "polarity")}
                  >
                    {reset.polarity}
                  </td>
                  <td
                    className="px-4 py-3 text-sm"
                    {...getCellProps(index, "direction")}
                  >
                    {displayDirection(reset.direction)}
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
                      style={{ color: "var(--vscode-errorForeground)" }}
                      title="Delete (d)"
                    >
                      <span className="codicon codicon-trash"></span>
                    </button>
                  </td>
                </tr>
              );
            })}
            {isAdding && renderEditRow(true)}
            {resets.length === 0 && !isAdding && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm"
                  style={{ opacity: 0.6 }}
                >
                  No resets defined. Press 'o' or click "Add Reset".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
