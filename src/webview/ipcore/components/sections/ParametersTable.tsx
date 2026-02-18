import React from "react";
import {
  FormField,
  SelectField,
  NumberField,
  CheckboxField,
} from "../../../shared/components";
import {
  validateVhdlIdentifier,
  validateUniqueName,
} from "../../../shared/utils/validation";
import { useVimTableNavigation } from "../../hooks/useVimTableNavigation";

interface Parameter {
  name: string;
  dataType: string;
  defaultValue: any;
  description?: string;
}

interface ParametersTableProps {
  parameters: Parameter[];
  onUpdate: (path: Array<string | number>, value: any) => void;
}

const createEmptyParameter = (): Parameter => ({
  name: "",
  dataType: "integer",
  defaultValue: 0,
  description: "",
});

const COLUMN_KEYS = ["name", "dataType", "defaultValue", "description"];

/**
 * Editable table for IP Core parameters
 * Vim-style: h/j/k/l navigate cells, e edit, d delete, o add
 */
export const ParametersTable: React.FC<ParametersTableProps> = ({
  parameters,
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
  } = useVimTableNavigation<Parameter>({
    items: parameters,
    onUpdate,
    dataKey: "parameters",
    createEmptyItem: createEmptyParameter,
    columnKeys: COLUMN_KEYS,
  });

  const handleDataTypeChange = (newType: string) => {
    let newDefault: any = "";
    if (newType === "integer") {
      newDefault = 0;
    } else if (newType === "boolean") {
      newDefault = false;
    } else if (newType === "string") {
      newDefault = "";
    }
    setDraft({ ...draft, dataType: newType, defaultValue: newDefault });
  };

  const existingNames = parameters
    .map((p) => p.name)
    .filter((_, i) => i !== editingIndex);
  const nameError =
    validateVhdlIdentifier(draft.name) ||
    validateUniqueName(draft.name, existingNames);
  const canSave = !nameError;

  const renderDefaultValueField = () => {
    switch (draft.dataType) {
      case "integer":
        return (
          <NumberField
            label=""
            value={
              typeof draft.defaultValue === "number" ? draft.defaultValue : 0
            }
            onChange={(v: number) => setDraft({ ...draft, defaultValue: v })}
            data-edit-key="defaultValue"
            onSave={canSave ? handleSave : undefined}
            onCancel={handleCancel}
          />
        );
      case "boolean":
        return (
          <CheckboxField
            label="True"
            checked={!!draft.defaultValue}
            onChange={(v: boolean) => setDraft({ ...draft, defaultValue: v })}
            data-edit-key="defaultValue"
          />
        );
      default:
        return (
          <FormField
            label=""
            value={String(draft.defaultValue || "")}
            onChange={(v: string) => setDraft({ ...draft, defaultValue: v })}
            placeholder="default value"
            data-edit-key="defaultValue"
            onSave={canSave ? handleSave : undefined}
            onCancel={handleCancel}
          />
        );
    }
  };

  const formatDefaultValue = (param: Parameter): string => {
    if (param.dataType === "boolean") {
      return param.defaultValue ? "true" : "false";
    }
    if (param.dataType === "integer") {
      return String(param.defaultValue ?? 0);
    }
    // For string type, show the value or empty string
    return String(param.defaultValue ?? "");
  };

  const renderEditRow = (isNew: boolean) => (
    <tr
      style={{
        background: "var(--vscode-list-activeSelectionBackground)",
        borderBottom: "1px solid var(--vscode-panel-border)",
      }}
      data-row-idx={editingIndex ?? parameters.length}
    >
      <td className="px-4 py-3">
        <FormField
          label=""
          value={draft.name}
          onChange={(v: string) => setDraft({ ...draft, name: v })}
          error={nameError || undefined}
          placeholder="PARAM_NAME"
          required
          data-edit-key="name"
          onSave={canSave ? handleSave : undefined}
          onCancel={handleCancel}
        />
      </td>
      <td className="px-4 py-3">
        <SelectField
          label=""
          value={draft.dataType}
          options={[
            { value: "integer", label: "integer" },
            { value: "boolean", label: "boolean" },
            { value: "string", label: "string" },
          ]}
          onChange={handleDataTypeChange}
          data-edit-key="dataType"
          onSave={canSave ? handleSave : undefined}
          onCancel={handleCancel}
        />
      </td>
      <td className="px-4 py-3">{renderDefaultValueField()}</td>
      <td className="px-4 py-3">
        <FormField
          label=""
          value={draft.description || ""}
          onChange={(v: string) => setDraft({ ...draft, description: v })}
          placeholder="Optional description"
          data-edit-key="description"
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
          <h2 className="text-xl font-medium">Parameters</h2>
          <p className="text-sm mt-1" style={{ opacity: 0.7 }}>
            {parameters.length} parameter{parameters.length !== 1 ? "s" : ""} •
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
          <span className="codicon codicon-add"></span>Add Parameter
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
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase opacity-70">
                Data Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase opacity-70">
                Default Value
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase opacity-70">
                Description
              </th>
              <th className="px-4 py-3 text-right text-xs font-semibold uppercase opacity-70">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {parameters.map((param, index) => {
              if (editingIndex === index) {
                return (
                  <React.Fragment key={index}>
                    {renderEditRow(false)}
                  </React.Fragment>
                );
              }
              const rowProps = getRowProps(index);
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
                    {param.name}
                  </td>
                  <td
                    className="px-4 py-3 text-sm"
                    {...getCellProps(index, "dataType")}
                  >
                    {param.dataType}
                  </td>
                  <td
                    className="px-4 py-3 text-sm font-mono"
                    {...getCellProps(index, "defaultValue")}
                  >
                    {formatDefaultValue(param)}
                  </td>
                  <td
                    className="px-4 py-3 text-sm"
                    {...getCellProps(index, "description")}
                    style={{
                      ...getCellProps(index, "description").style,
                      opacity: param.description ? 1 : 0.5,
                    }}
                  >
                    {param.description || "—"}
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
            {parameters.length === 0 && !isAdding && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-sm"
                  style={{ opacity: 0.6 }}
                >
                  No parameters defined. Press 'o' or click "Add Parameter".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
