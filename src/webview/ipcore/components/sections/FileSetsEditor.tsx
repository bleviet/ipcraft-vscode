import React, { useState, useEffect } from "react";
import {
  FormField,
  TextAreaField,
  SelectField,
} from "../../../shared/components";
import { validateRequired } from "../../../shared/utils/validation";
import { vscode } from "../../../vscode";

interface FileEntry {
  path: string;
  type: string;
}

interface FileSet {
  name: string;
  description?: string;
  files: FileEntry[];
  import?: string;
}

interface FileSetsEditorProps {
  fileSets: FileSet[];
  onUpdate: (path: Array<string | number>, value: any) => void;
}

/**
 * Editor for IP Core file sets
 * Supports adding/editing file sets and files within them
 */
export const FileSetsEditor: React.FC<FileSetsEditorProps> = ({
  fileSets,
  onUpdate,
}) => {
  const [expandedSets, setExpandedSets] = useState<Set<number>>(new Set([0]));
  const [editingSet, setEditingSet] = useState<number | null>(null);
  const [editingFile, setEditingFile] = useState<{
    setIdx: number;
    fileIdx: number;
  } | null>(null);
  const [isAddingSet, setIsAddingSet] = useState(false);
  const [isAddingFile, setIsAddingFile] = useState<number | null>(null);
  const [fileExistence, setFileExistence] = useState<{
    [key: string]: boolean;
  }>({});

  const [setDraft, setSetDraft] = useState({ name: "", description: "" });
  const [fileDraft, setFileDraft] = useState({ path: "", type: "verilog" });

  const fileTypeOptions = [
    { value: "verilog", label: "Verilog" },
    { value: "vhdl", label: "VHDL" },
    { value: "systemverilog", label: "SystemVerilog" },
    { value: "c", label: "C" },
    { value: "cpp", label: "C++" },
    { value: "tcl", label: "TCL" },
    { value: "python", label: "Python" },
    { value: "pdf", label: "PDF" },
    { value: "text", label: "Text" },
  ];

  const toggleSet = (idx: number) => {
    const newExpanded = new Set(expandedSets);
    if (newExpanded.has(idx)) {
      newExpanded.delete(idx);
    } else {
      newExpanded.add(idx);
    }
    setExpandedSets(newExpanded);
  };

  // Check file existence when fileSets change
  useEffect(() => {
    const allPaths = fileSets.flatMap((fs) => {
      const paths = (fs.files || []).map((f) => f.path);
      if (fs.import) paths.push(fs.import);
      return paths;
    });
    if (allPaths.length === 0) return;

    // Send message to extension to check file existence
    vscode?.postMessage({
      type: "checkFilesExist",
      paths: allPaths,
    });

    // Listen for response
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === "filesExistResult" && message.results) {
        setFileExistence((prev) => ({ ...prev, ...message.results }));
        window.removeEventListener("message", handler);
      }
    };
    window.addEventListener("message", handler);

    return () => window.removeEventListener("message", handler);
  }, [fileSets]);

  // Open file in editor
  const handleOpenFile = (filePath: string) => {
    const exists = fileExistence[filePath];
    if (exists === false) {
      // File doesn't exist - don't try to open
      return;
    }
    vscode?.postMessage({
      type: "command",
      command: "openFile",
      path: filePath,
    });
  };

  const handleAddSet = () => {
    setIsAddingSet(true);
    setSetDraft({ name: "", description: "" });
  };

  const handleSaveSet = () => {
    if (isAddingSet) {
      const newSet: FileSet = { ...setDraft, files: [] };
      onUpdate(["fileSets"], [...fileSets, newSet]);
    } else if (editingSet !== null) {
      const updated = [...fileSets];
      updated[editingSet] = { ...updated[editingSet], ...setDraft };
      onUpdate(["fileSets"], updated);
    }
    setIsAddingSet(false);
    setEditingSet(null);
  };

  const handleDeleteSet = (idx: number) => {
    // Remove confirmation - webview confirm() may not work properly
    onUpdate(
      ["fileSets"],
      fileSets.filter((_, i) => i !== idx),
    );
  };

  const handleBrowseFile = (setIdx: number) => {
    // Send message to extension to open file picker
    vscode?.postMessage({
      type: "selectFiles",
      multi: true,
    });

    // Listen for response
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (
        message.type === "filesSelected" &&
        message.files &&
        message.files.length > 0
      ) {
        // Auto-detect file type based on extension
        const detectFileType = (filePath: string): string => {
          const ext = filePath.split(".").pop()?.toLowerCase();
          const typeMap: { [key: string]: string } = {
            v: "verilog",
            vh: "verilog",
            sv: "systemverilog",
            vhd: "vhdl",
            vhdl: "vhdl",
            c: "c",
            h: "c",
            cpp: "cpp",
            hpp: "cpp",
            cc: "cpp",
            tcl: "tcl",
            py: "python",
            pdf: "pdf",
            txt: "text",
            md: "text",
          };
          return typeMap[ext || ""] || "text";
        };

        // Add all selected files
        const fileSet = fileSets[setIdx];
        const newFiles = message.files.map((filePath: string) => ({
          path: filePath,
          type: detectFileType(filePath),
        }));

        const updatedFiles = [...(fileSet.files || []), ...newFiles];
        const updated = [...fileSets];
        updated[setIdx] = { ...fileSet, files: updatedFiles };
        onUpdate(["fileSets"], updated);

        // Close the add file form
        setIsAddingFile(null);

        window.removeEventListener("message", handler);
      }
    };
    window.addEventListener("message", handler);
  };

  const handleAddFile = (setIdx: number) => {
    setIsAddingFile(setIdx);
    setFileDraft({ path: "", type: "verilog" });
  };

  const handleSaveFile = (setIdx: number) => {
    const fileSet = fileSets[setIdx];
    if (isAddingFile === setIdx) {
      const updatedFiles = [...(fileSet.files || []), fileDraft];
      const updated = [...fileSets];
      updated[setIdx] = { ...fileSet, files: updatedFiles };
      onUpdate(["fileSets"], updated);
    } else if (editingFile && editingFile.setIdx === setIdx) {
      const updatedFiles = [...(fileSet.files || [])];
      updatedFiles[editingFile.fileIdx] = fileDraft;
      const updated = [...fileSets];
      updated[setIdx] = { ...fileSet, files: updatedFiles };
      onUpdate(["fileSets"], updated);
    }
    setIsAddingFile(null);
    setEditingFile(null);
  };

  const handleDeleteFile = (setIdx: number, fileIdx: number) => {
    const fileSet = fileSets[setIdx];
    // Remove confirmation - webview confirm() may not work properly
    const updatedFiles = (fileSet.files || []).filter((_, i) => i !== fileIdx);
    const updated = [...fileSets];
    updated[setIdx] = { ...fileSet, files: updatedFiles };
    onUpdate(["fileSets"], updated);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-medium">File Sets</h2>
          <p className="text-sm mt-1" style={{ opacity: 0.7 }}>
            {fileSets.length} file set{fileSets.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={handleAddSet}
          disabled={isAddingSet || editingSet !== null}
          className="px-4 py-2 rounded text-sm flex items-center gap-2"
          style={{
            background:
              isAddingSet || editingSet !== null
                ? "var(--vscode-button-secondaryBackground)"
                : "var(--vscode-button-background)",
            color: "var(--vscode-button-foreground)",
            opacity: isAddingSet || editingSet !== null ? 0.5 : 1,
          }}
        >
          <span className="codicon codicon-add"></span>
          Add File Set
        </button>
      </div>

      <div className="space-y-3">
        {fileSets.map((fileSet, setIdx) => (
          <div
            key={setIdx}
            className="rounded overflow-hidden"
            style={{
              border: "1px solid var(--vscode-panel-border)",
              background: "var(--vscode-editor-background)",
            }}
          >
            {/* File Set Header */}
            <div
              className="px-4 py-3 flex items-center justify-between cursor-pointer"
              style={{
                background: "var(--vscode-sideBar-background)",
                borderBottom: expandedSets.has(setIdx)
                  ? "1px solid var(--vscode-panel-border)"
                  : "none",
              }}
              onClick={() => toggleSet(setIdx)}
            >
              <div className="flex items-center gap-3 flex-1">
                <span
                  className={`codicon codicon-chevron-${expandedSets.has(setIdx) ? "down" : "right"}`}
                ></span>
                <div>
                  <p className="font-medium text-sm">
                    {fileSet.name || "(imported)"}
                  </p>
                  {fileSet.description && (
                    <p className="text-xs mt-1" style={{ opacity: 0.7 }}>
                      {fileSet.description}
                    </p>
                  )}
                  {fileSet.import && (
                    <p
                      className="text-xs mt-1 font-mono"
                      style={{ opacity: 0.7 }}
                    >
                      Import: {fileSet.import}
                    </p>
                  )}
                </div>
              </div>
              <div
                className="flex items-center gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                <span
                  className="text-xs px-2 py-1 rounded"
                  style={{
                    background: "var(--vscode-badge-background)",
                    color: "var(--vscode-badge-foreground)",
                  }}
                >
                  {fileSet.files?.length || 0} files
                </span>
                {!fileSet.import && (
                  <>
                    <button
                      onClick={() => {
                        setEditingSet(setIdx);
                        setSetDraft({
                          name: fileSet.name,
                          description: fileSet.description || "",
                        });
                      }}
                      className="p-1"
                      title="Edit"
                    >
                      <span className="codicon codicon-edit"></span>
                    </button>
                    <button
                      onClick={() => handleDeleteSet(setIdx)}
                      className="p-1"
                      style={{ color: "var(--vscode-errorForeground)" }}
                      title="Delete"
                    >
                      <span className="codicon codicon-trash"></span>
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Expanded Content */}
            {expandedSets.has(setIdx) && (
              <div className="p-4 space-y-3">
                {fileSet.import ? (
                  <div
                    className="p-4 rounded border-l-4"
                    style={{
                      background:
                        fileExistence[fileSet.import!] === false
                          ? "rgba(255, 0, 0, 0.1)"
                          : "var(--vscode-editor-background)",
                      border: "1px solid var(--vscode-panel-border)",
                      borderLeftColor:
                        fileExistence[fileSet.import!] === false
                          ? "var(--vscode-errorForeground)"
                          : "var(--vscode-textLink-foreground)",
                    }}
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">External File Set</h3>
                        {fileExistence[fileSet.import!] === false && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{
                              background: "var(--vscode-errorForeground)",
                              color: "white",
                            }}
                          >
                            Missing
                          </span>
                        )}
                      </div>
                    </div>

                    <p className="text-sm mb-4" style={{ opacity: 0.8 }}>
                      Linked file:{" "}
                      <code
                        className="px-1 py-0.5 rounded"
                        style={{
                          background: "var(--vscode-textBlockQuote-background)",
                        }}
                      >
                        {fileSet.import}
                      </code>
                    </p>

                    <button
                      onClick={() => handleOpenFile(fileSet.import!)}
                      className="px-4 py-2 rounded text-sm flex items-center gap-2"
                      style={{
                        background: "var(--vscode-button-background)",
                        color: "var(--vscode-button-foreground)",
                      }}
                    >
                      <span className="codicon codicon-go-to-file"></span>
                      Open File Set
                    </button>

                    {fileExistence[fileSet.import!] === false && (
                      <div
                        className="mt-3 text-xs flex items-center gap-2"
                        style={{ color: "var(--vscode-errorForeground)" }}
                      >
                        <span className="codicon codicon-error"></span>
                        <span>File not found on disk</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      {(fileSet.files || []).map((file, fileIdx) => {
                        const isEditing =
                          editingFile?.setIdx === setIdx &&
                          editingFile?.fileIdx === fileIdx;

                        if (isEditing) {
                          return (
                            <div
                              key={fileIdx}
                              className="flex items-center gap-2 p-2 rounded"
                              style={{
                                background:
                                  "var(--vscode-list-activeSelectionBackground)",
                              }}
                            >
                              <FormField
                                label=""
                                value={fileDraft.path}
                                onChange={(v: string) =>
                                  setFileDraft({ ...fileDraft, path: v })
                                }
                                placeholder="path/to/file.v"
                                required
                                onSave={() => handleSaveFile(setIdx)}
                                onCancel={() => setEditingFile(null)}
                              />
                              <SelectField
                                label=""
                                value={fileDraft.type}
                                options={fileTypeOptions}
                                onChange={(v: string) =>
                                  setFileDraft({ ...fileDraft, type: v })
                                }
                                onSave={() => handleSaveFile(setIdx)}
                                onCancel={() => setEditingFile(null)}
                              />
                              <button
                                onClick={() => handleSaveFile(setIdx)}
                                className="px-3 py-1 rounded text-xs"
                                style={{
                                  background: "var(--vscode-button-background)",
                                  color: "var(--vscode-button-foreground)",
                                }}
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingFile(null)}
                                className="px-3 py-1 rounded text-xs"
                                style={{
                                  background:
                                    "var(--vscode-button-secondaryBackground)",
                                  color: "var(--vscode-button-foreground)",
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={fileIdx}
                            className="flex items-center justify-between p-2 rounded hover:opacity-80"
                            style={{
                              background:
                                fileExistence[file.path] === false
                                  ? "rgba(255, 0, 0, 0.15)"
                                  : "var(--vscode-input-background)",
                              borderLeft:
                                fileExistence[file.path] === false
                                  ? "3px solid var(--vscode-errorForeground)"
                                  : "none",
                            }}
                          >
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <span
                                className="codicon codicon-file"
                                style={{
                                  color:
                                    fileExistence[file.path] === false
                                      ? "var(--vscode-errorForeground)"
                                      : undefined,
                                }}
                              ></span>
                              <span
                                className="text-sm font-mono truncate"
                                style={{
                                  cursor:
                                    fileExistence[file.path] !== false
                                      ? "pointer"
                                      : "not-allowed",
                                  color:
                                    fileExistence[file.path] === false
                                      ? "var(--vscode-errorForeground)"
                                      : "var(--vscode-textLink-foreground)",
                                  textDecoration:
                                    fileExistence[file.path] !== false
                                      ? "underline"
                                      : "line-through",
                                  opacity:
                                    fileExistence[file.path] === false
                                      ? 0.8
                                      : 1,
                                }}
                                onClick={() => handleOpenFile(file.path)}
                                title={
                                  fileExistence[file.path] === false
                                    ? `File not found: ${file.path}`
                                    : `Click to open: ${file.path}`
                                }
                              >
                                {file.path}
                              </span>
                              {fileExistence[file.path] === false && (
                                <span
                                  className="text-xs px-1.5 py-0.5 rounded"
                                  style={{
                                    background: "var(--vscode-errorForeground)",
                                    color: "white",
                                  }}
                                >
                                  Missing
                                </span>
                              )}
                              <span
                                className="text-xs px-2 py-0.5 rounded"
                                style={{
                                  background: "var(--vscode-badge-background)",
                                  color: "var(--vscode-badge-foreground)",
                                }}
                              >
                                {file.type}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  setEditingFile({ setIdx, fileIdx });
                                  setFileDraft(file);
                                }}
                                className="p-1"
                                title="Edit"
                              >
                                <span className="codicon codicon-edit"></span>
                              </button>
                              <button
                                onClick={() =>
                                  handleDeleteFile(setIdx, fileIdx)
                                }
                                className="p-1"
                                style={{
                                  color: "var(--vscode-errorForeground)",
                                }}
                                title="Delete"
                              >
                                <span className="codicon codicon-trash"></span>
                              </button>
                            </div>
                          </div>
                        );
                      })}

                      {/* Add File Row - Just browse button since it handles multiple files */}
                      {isAddingFile === setIdx && (
                        <div
                          className="flex items-center gap-2 p-3 rounded"
                          style={{
                            background:
                              "var(--vscode-list-activeSelectionBackground)",
                          }}
                        >
                          <button
                            onClick={() => handleBrowseFile(setIdx)}
                            className="flex-1 px-4 py-2 rounded text-sm flex items-center justify-center gap-2"
                            style={{
                              background: "var(--vscode-button-background)",
                              color: "var(--vscode-button-foreground)",
                            }}
                          >
                            <span className="codicon codicon-folder-opened"></span>
                            Browse and Add Files...
                          </button>
                          <button
                            onClick={() => setIsAddingFile(null)}
                            className="px-3 py-2 rounded text-sm"
                            style={{
                              background:
                                "var(--vscode-button-secondaryBackground)",
                              color: "var(--vscode-button-foreground)",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Add File Button */}
                    {isAddingFile !== setIdx && (
                      <button
                        onClick={() => handleAddFile(setIdx)}
                        disabled={editingFile !== null || isAddingFile !== null}
                        className="px-3 py-1.5 rounded text-sm flex items-center gap-2"
                        style={{
                          background:
                            editingFile !== null || isAddingFile !== null
                              ? "var(--vscode-button-secondaryBackground)"
                              : "var(--vscode-button-background)",
                          color: "var(--vscode-button-foreground)",
                          opacity:
                            editingFile !== null || isAddingFile !== null
                              ? 0.5
                              : 1,
                        }}
                      >
                        <span className="codicon codicon-add"></span>
                        Add File
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Add New File Set */}
        {isAddingSet && (
          <div
            className="p-4 rounded space-y-3"
            style={{
              border: "1px solid var(--vscode-panel-border)",
              background: "var(--vscode-list-activeSelectionBackground)",
            }}
          >
            <FormField
              label="Name"
              value={setDraft.name}
              onChange={(v: string) => setSetDraft({ ...setDraft, name: v })}
              placeholder="RTL_Sources"
              required
              validator={validateRequired}
              onSave={setDraft.name ? handleSaveSet : undefined}
              onCancel={() => setIsAddingSet(false)}
            />
            <TextAreaField
              label="Description"
              value={setDraft.description || ""}
              onChange={(v: string) =>
                setSetDraft({ ...setDraft, description: v })
              }
              placeholder="Optional description"
              rows={2}
              onSave={setDraft.name ? handleSaveSet : undefined}
              onCancel={() => setIsAddingSet(false)}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveSet}
                disabled={!setDraft.name}
                className="px-4 py-2 rounded text-sm"
                style={{
                  background: setDraft.name
                    ? "var(--vscode-button-background)"
                    : "var(--vscode-button-secondaryBackground)",
                  color: "var(--vscode-button-foreground)",
                  opacity: setDraft.name ? 1 : 0.5,
                }}
              >
                Create File Set
              </button>
              <button
                onClick={() => setIsAddingSet(false)}
                className="px-4 py-2 rounded text-sm"
                style={{
                  background: "var(--vscode-button-secondaryBackground)",
                  color: "var(--vscode-button-foreground)",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Edit File Set */}
        {editingSet !== null && !isAddingSet && (
          <div
            className="p-4 rounded space-y-3"
            style={{
              border: "1px solid var(--vscode-panel-border)",
              background: "var(--vscode-list-activeSelectionBackground)",
            }}
          >
            <h3 className="font-semibold">Edit File Set</h3>
            <FormField
              label="Name"
              value={setDraft.name}
              onChange={(v: string) => setSetDraft({ ...setDraft, name: v })}
              placeholder="RTL_Sources"
              required
              validator={validateRequired}
              onSave={setDraft.name ? handleSaveSet : undefined}
              onCancel={() => setEditingSet(null)}
            />
            <TextAreaField
              label="Description"
              value={setDraft.description || ""}
              onChange={(v: string) =>
                setSetDraft({ ...setDraft, description: v })
              }
              placeholder="Optional description"
              rows={2}
              onSave={setDraft.name ? handleSaveSet : undefined}
              onCancel={() => setEditingSet(null)}
            />
            <div className="flex items-center gap-2">
              <button
                onClick={handleSaveSet}
                disabled={!setDraft.name}
                className="px-4 py-2 rounded text-sm"
                style={{
                  background: setDraft.name
                    ? "var(--vscode-button-background)"
                    : "var(--vscode-button-secondaryBackground)",
                  color: "var(--vscode-button-foreground)",
                  opacity: setDraft.name ? 1 : 0.5,
                }}
              >
                Save Changes
              </button>
              <button
                onClick={() => setEditingSet(null)}
                className="px-4 py-2 rounded text-sm"
                style={{
                  background: "var(--vscode-button-secondaryBackground)",
                  color: "var(--vscode-button-foreground)",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {fileSets.length === 0 && !isAddingSet && (
          <div className="p-8 text-center text-sm" style={{ opacity: 0.6 }}>
            No file sets defined. Click "Add File Set" to create one.
          </div>
        )}
      </div>
    </div>
  );
};
