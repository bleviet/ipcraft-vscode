import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  FormField,
  SelectField,
  TextAreaField,
} from "../../../shared/components";
import {
  validateRequired,
  validateVersion,
} from "../../../shared/utils/validation";

interface MetadataEditorProps {
  ipCore: any;
  onUpdate: (path: Array<string | number>, value: any) => void;
}

interface MetadataRow {
  key: string;
  label: string;
  path: (string | number)[];
  getValue: (ipCore: any) => string;
  type?: "text" | "select" | "textarea";
  options?: { value: string; label: string }[];
  validator?: (value: string) => string | null;
  required?: boolean;
  placeholder?: string;
}

const METADATA_ROWS: MetadataRow[] = [
  {
    key: "apiVersion",
    label: "API Version",
    path: ["apiVersion"],
    getValue: (ip) => {
      const val = ip?.apiVersion;
      if (val === undefined || val === null) {
        return "1.0";
      }
      // Convert number to string, ensuring 1 becomes "1.0"
      if (typeof val === "number") {
        return Number.isInteger(val) ? `${val}.0` : String(val);
      }
      return String(val);
    },
    type: "select",
    options: [{ value: "1.0", label: "1.0" }],
    required: true,
  },
  {
    key: "vendor",
    label: "Vendor",
    path: ["vlnv", "vendor"],
    getValue: (ip) => ip?.vlnv?.vendor || "",
    validator: validateRequired,
    required: true,
    placeholder: "e.g., my-company.com",
  },
  {
    key: "library",
    label: "Library",
    path: ["vlnv", "library"],
    getValue: (ip) => ip?.vlnv?.library || "",
    validator: validateRequired,
    required: true,
    placeholder: "e.g., my_lib",
  },
  {
    key: "name",
    label: "Name",
    path: ["vlnv", "name"],
    getValue: (ip) => ip?.vlnv?.name || "",
    validator: validateRequired,
    required: true,
    placeholder: "e.g., my_core",
  },
  {
    key: "version",
    label: "Version",
    path: ["vlnv", "version"],
    getValue: (ip) => ip?.vlnv?.version || "",
    validator: validateVersion,
    required: true,
    placeholder: "e.g., 1.0.0",
  },
  {
    key: "description",
    label: "Description",
    path: ["description"],
    getValue: (ip) => ip?.description || "",
    type: "textarea",
    placeholder: "Describe the IP core...",
  },
];

/**
 * Metadata editor for IP Core VLNV and description
 * Uses table format matching other section editors
 * Supports vim-style navigation: j/k for rows, e to edit, Escape to cancel
 */
export const MetadataEditor: React.FC<MetadataEditorProps> = ({
  ipCore,
  onUpdate,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const handleEdit = useCallback(
    (key: string) => {
      const row = METADATA_ROWS.find((r) => r.key === key);
      if (row) {
        setDraft(row.getValue(ipCore));
        setEditingKey(key);
      }
    },
    [ipCore],
  );

  const handleSave = useCallback(() => {
    const row = METADATA_ROWS.find((r) => r.key === editingKey);
    if (row) {
      onUpdate(row.path, draft);
    }
    setEditingKey(null);
    setDraft("");
    setTimeout(() => containerRef.current?.focus(), 0);
  }, [editingKey, draft, onUpdate]);

  const handleCancel = useCallback(() => {
    setEditingKey(null);
    setDraft("");
    setTimeout(() => containerRef.current?.focus(), 0);
  }, []);

  // Auto-focus input when editing starts
  useEffect(() => {
    if (editingKey) {
      const timerId = setTimeout(() => {
        const container = containerRef.current;
        if (!container) {
          return;
        }
        const input = container.querySelector(
          `[data-edit-key="${editingKey}"]`,
        ) as HTMLElement;
        if (input) {
          input.focus();
        }
      }, 0);
      return () => clearTimeout(timerId);
    }
  }, [editingKey]);

  // Keyboard navigation
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isTyping = target.closest(
        'input, textarea, select, [contenteditable="true"], vscode-text-field, vscode-text-area, vscode-dropdown',
      );

      if (isTyping || editingKey !== null) {
        if (e.key === "Escape") {
          e.preventDefault();
          handleCancel();
        }
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        return;
      }

      const key = e.key.toLowerCase();

      if (key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) =>
          Math.min(prev + 1, METADATA_ROWS.length - 1),
        );
      } else if (key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (key === "e" || e.key === "Enter") {
        e.preventDefault();
        handleEdit(METADATA_ROWS[selectedIndex].key);
      } else if (key === "g") {
        e.preventDefault();
        setSelectedIndex(0);
      } else if (e.key === "G" && e.shiftKey) {
        e.preventDefault();
        setSelectedIndex(METADATA_ROWS.length - 1);
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, editingKey, handleEdit, handleCancel]);

  const renderEditField = (row: MetadataRow) => {
    const validationError = row.validator ? row.validator(draft) : null;
    const canSave = !validationError || !row.required;

    // Common props for all fields
    const commonProps = {
      onSave: canSave ? handleSave : undefined,
      onCancel: handleCancel,
    };

    if (row.type === "select") {
      return (
        <div className="flex items-center gap-2">
          <SelectField
            label=""
            value={draft}
            options={row.options || []}
            onChange={setDraft}
            data-edit-key={row.key}
            {...commonProps}
          />
          <button
            onClick={handleSave}
            className="px-3 py-1 rounded text-xs"
            style={{
              background: "var(--vscode-button-background)",
              color: "var(--vscode-button-foreground)",
            }}
          >
            Save
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
        </div>
      );
    }

    if (row.type === "textarea") {
      return (
        <div className="flex flex-col gap-2">
          <TextAreaField
            label=""
            value={draft}
            onChange={setDraft}
            placeholder={row.placeholder}
            rows={3}
            data-edit-key={row.key}
            {...commonProps}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              className="px-3 py-1 rounded text-xs"
              style={{
                background: "var(--vscode-button-background)",
                color: "var(--vscode-button-foreground)",
              }}
            >
              Save
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
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-2">
        <FormField
          label=""
          value={draft}
          onChange={setDraft}
          placeholder={row.placeholder}
          error={validationError || undefined}
          required={row.required}
          data-edit-key={row.key}
          {...commonProps}
        />
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="px-3 py-1 rounded text-xs"
          style={{
            background: canSave
              ? "var(--vscode-button-background)"
              : "var(--vscode-button-secondaryBackground)",
            color: "var(--vscode-button-foreground)",
            opacity: canSave ? 1 : 0.5,
          }}
        >
          Save
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
      </div>
    );
  };

  return (
    <div ref={containerRef} className="p-6 space-y-4 outline-none" tabIndex={0}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-medium">Metadata</h2>
          <p className="text-sm mt-1" style={{ opacity: 0.7 }}>
            {METADATA_ROWS.length} fields •
            <span className="ml-2 text-xs font-mono" style={{ opacity: 0.5 }}>
              j/k: navigate • e: edit
            </span>
          </p>
        </div>
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
              <th
                className="px-4 py-3 text-left text-xs font-semibold uppercase opacity-70"
                style={{ width: "150px" }}
              >
                Field
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase opacity-70">
                Value
              </th>
              <th
                className="px-4 py-3 text-right text-xs font-semibold uppercase opacity-70"
                style={{ width: "80px" }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {METADATA_ROWS.map((row, index) => {
              const isSelected = selectedIndex === index;
              const isEditing = editingKey === row.key;
              const value = row.getValue(ipCore);

              return (
                <tr
                  key={row.key}
                  data-row-idx={index}
                  onClick={() => setSelectedIndex(index)}
                  onDoubleClick={() => handleEdit(row.key)}
                  style={{
                    background: isEditing
                      ? "var(--vscode-list-activeSelectionBackground)"
                      : isSelected
                        ? "var(--vscode-list-inactiveSelectionBackground)"
                        : "transparent",
                    borderBottom: "1px solid var(--vscode-panel-border)",
                    cursor: "pointer",
                  }}
                >
                  <td
                    className="px-4 py-3 text-sm font-medium"
                    style={{ opacity: 0.8 }}
                  >
                    {row.label}
                    {row.required && (
                      <span style={{ color: "var(--vscode-errorForeground)" }}>
                        {" "}
                        *
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {isEditing ? (
                      renderEditField(row)
                    ) : (
                      <span
                        className="font-mono"
                        style={{
                          whiteSpace:
                            row.type === "textarea" ? "pre-wrap" : "normal",
                        }}
                      >
                        {value || <span style={{ opacity: 0.5 }}>—</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!isEditing && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(row.key);
                        }}
                        disabled={editingKey !== null}
                        className="p-1 rounded"
                        style={{ opacity: editingKey !== null ? 0.3 : 1 }}
                        title="Edit (e)"
                      >
                        <span className="codicon codicon-edit"></span>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
