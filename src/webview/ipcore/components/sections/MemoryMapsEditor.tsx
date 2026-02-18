import React, { useCallback, useEffect } from "react";
import { vscode } from "../../../vscode";

interface MemoryMapsEditorProps {
  memoryMaps: any;
  imports?: { memoryMaps?: any[] };
  onUpdate: (path: Array<string | number>, value: any) => void;
}

export const MemoryMapsEditor: React.FC<MemoryMapsEditorProps> = ({
  memoryMaps,
  imports,
  onUpdate,
}) => {
  // Check if it's an import object (as per schema using 'import' keyword)
  // The memoryMaps field in the yaml is usually:
  // memoryMaps:
  //   import: "path/to/file"
  const importFile = memoryMaps?.import;
  const detectedMaps = imports?.memoryMaps || [];

  const handleLinkFile = useCallback(() => {
    // Send message to extension to open file picker with filter
    vscode?.postMessage({
      type: "selectFiles",
      multi: false, // Single file selection
      filters: { "Memory Map": ["memmap.yml", "yml"] },
    });

    // Listen for response
    const handler = (event: MessageEvent) => {
      const message = event.data;
      if (
        message.type === "filesSelected" &&
        message.files &&
        message.files.length > 0
      ) {
        // Update the memory map import
        // We update the whole memoryMaps object to be { import: "path" }
        // Use onUpdate(['memoryMaps'], { import: filePath })
        const filePath = message.files[0];
        onUpdate(["memoryMaps"], { import: filePath });

        window.removeEventListener("message", handler);
      }
    };
    window.addEventListener("message", handler);
  }, [onUpdate]);

  const handleUnlink = useCallback(() => {
    // Clear the memoryMaps object or set it to undefined/empty
    onUpdate(["memoryMaps"], undefined);
  }, [onUpdate]);

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-xl font-medium">Memory Maps</h2>

      {importFile ? (
        <div className="space-y-4">
          <div
            className="p-4 rounded border-l-4"
            style={{
              background: "var(--vscode-editor-background)",
              border: "1px solid var(--vscode-panel-border)",
              borderLeftColor: "var(--vscode-textLink-foreground)",
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold">External Memory Map</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleLinkFile}
                  className="p-1.5 rounded opacity-70 hover:opacity-100"
                  title="Change Linked File"
                >
                  <span className="codicon codicon-edit"></span>
                </button>
                <button
                  onClick={handleUnlink}
                  className="p-1.5 rounded opacity-70 hover:opacity-100"
                  style={{ color: "var(--vscode-errorForeground)" }}
                  title="Unlink File"
                >
                  <span className="codicon codicon-close"></span>
                </button>
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
                {importFile}
              </code>
            </p>

            <button
              onClick={() =>
                vscode.postMessage({
                  type: "command",
                  command: "openFile",
                  path: importFile,
                })
              }
              className="px-4 py-2 rounded text-sm flex items-center gap-2"
              style={{
                background: "var(--vscode-button-background)",
                color: "var(--vscode-button-foreground)",
              }}
            >
              <span className="codicon codicon-go-to-file"></span>
              Open Memory Map Editor
            </button>
          </div>

          {/* Detected Memory Maps List */}
          <div>
            <h3 className="text-sm font-semibold mb-3">Detected Memory Maps</h3>
            {detectedMaps.length > 0 ? (
              <div className="space-y-3">
                {detectedMaps.map((map: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-4 rounded border"
                    style={{
                      background: "var(--vscode-editor-background)",
                      borderColor: "var(--vscode-panel-border)",
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
                            {map.name}
                          </span>
                          <span
                            className="text-xs px-2 py-0.5 rounded"
                            style={{
                              background: "var(--vscode-badge-background)",
                              color: "var(--vscode-badge-foreground)",
                            }}
                          >
                            {map.addressBlocks?.length || 0} Block
                            {map.addressBlocks?.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                        {map.description && (
                          <p className="text-sm mt-1" style={{ opacity: 0.8 }}>
                            {map.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Address Blocks Preview */}
                    {map.addressBlocks && map.addressBlocks.length > 0 && (
                      <div
                        className="mt-3 pl-4 border-l-2"
                        style={{ borderColor: "var(--vscode-panel-border)" }}
                      >
                        <p
                          className="text-xs font-semibold mb-1"
                          style={{ opacity: 0.6 }}
                        >
                          ADDRESS BLOCKS
                        </p>
                        <div className="grid gap-1">
                          {map.addressBlocks.map((block: any, bIdx: number) => (
                            <div
                              key={bIdx}
                              className="text-sm font-mono flex items-center gap-3"
                              style={{ opacity: 0.8 }}
                            >
                              <span>{block.name}</span>
                              <span style={{ opacity: 0.5 }}>
                                Offset: {block.offset || block.baseAddress || 0}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div
                className="p-8 text-center text-sm"
                style={{
                  opacity: 0.6,
                  border: "1px dashed var(--vscode-panel-border)",
                  borderRadius: "4px",
                }}
              >
                No memory maps found in the linked file.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          className="p-8 text-center"
          style={{
            opacity: 0.6,
            border: "1px dashed var(--vscode-panel-border)",
            borderRadius: "4px",
          }}
        >
          <p className="text-sm mb-4">No external memory map linked.</p>
          <button
            onClick={handleLinkFile}
            className="px-4 py-2 rounded text-sm flex items-center justify-center gap-2 mx-auto"
            style={{
              background: "var(--vscode-button-secondaryBackground)",
              color: "var(--vscode-button-secondaryForeground)",
            }}
          >
            <span className="codicon codicon-link"></span>
            Link .mm.yml
          </button>
          <p className="text-xs mt-2 opacity-80">
            Link an existing memory map file to include its address blocks and
            registers.
          </p>
        </div>
      )}
    </div>
  );
};
