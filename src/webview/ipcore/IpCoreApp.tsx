import React, { useEffect, useState, useRef, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { NavigationSidebar } from "./components/layout/NavigationSidebar";
import { EditorPanel } from "./components/layout/EditorPanel";
import { useIpCoreState } from "./hooks/useIpCoreState";
import { useNavigation } from "./hooks/useNavigation";
import { useIpCoreSync } from "./hooks/useIpCoreSync";
import { vscode } from "../vscode";

export type FocusedPanel = "left" | "right";

/**
 * Main IP Core Visual Editor application
 */
const IpCoreApp: React.FC = () => {
  const {
    ipCore,
    rawYaml,
    parseError,
    fileName,
    imports,
    updateFromYaml,
    updateIpCore,
    getValidationErrors,
  } = useIpCoreState();
  const { selectedSection, navigate } = useNavigation();
  const { sendUpdate } = useIpCoreSync(rawYaml);

  // Sidebar toggle state for mobile
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Panel focus state for Ctrl+H/L navigation
  const [focusedPanel, setFocusedPanel] = useState<FocusedPanel>("left");
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  // Highlight state for validation errors
  const [highlight, setHighlight] = useState<
    { entityName: string; field: string } | undefined
  >(undefined);

  const validationErrors = getValidationErrors();

  // Clear highlight if the error is no longer in the validation list (e.g., fixed by undo or edit)
  useEffect(() => {
    if (highlight) {
      const errorStillExists = validationErrors.some(
        (e) =>
          e.entityName === highlight.entityName && e.field === highlight.field,
      );
      if (!errorStillExists) {
        setHighlight(undefined);
      }
    }
  }, [validationErrors, highlight]);

  // Handle global keyboard shortcuts for panel switching
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+H: Focus left panel
      if (e.ctrlKey && e.key.toLowerCase() === "h") {
        e.preventDefault();
        setFocusedPanel("left");
        leftPanelRef.current?.focus();
      }
      // Ctrl+L: Focus right panel (EditorPanel's useEffect will auto-focus the table)
      else if (e.ctrlKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setFocusedPanel("right");
        // The EditorPanel will auto-focus the inner table container via its useEffect
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Notify extension that webview is ready
  useEffect(() => {
    if (vscode) {
      vscode.postMessage({ type: "ready" });
    }
  }, []);

  // Listen for messages from extension
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      switch (message.type) {
        case "update":
          updateFromYaml(message.text, message.fileName, message.imports);
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [updateFromYaml]);

  return (
    <div
      className="h-screen flex flex-col"
      style={{
        background: "var(--vscode-editor-background)",
        color: "var(--vscode-editor-foreground)",
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-2"
        style={{
          borderBottom: "1px solid var(--vscode-panel-border)",
          background: "var(--vscode-sideBar-background)",
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {/* Mobile sidebar toggle */}
            <button
              className="sidebar-toggle-btn p-2 rounded-md transition-colors vscode-icon-button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              title="Toggle navigation"
              type="button"
            >
              <span className="codicon codicon-menu"></span>
            </button>
            <h1 className="text-sm font-semibold">
              {fileName || "IP Core Editor"}
            </h1>
            {ipCore?.vlnv && (
              <span className="text-xs" style={{ opacity: 0.7 }}>
                {ipCore.vlnv.vendor} / {ipCore.vlnv.library} /{" "}
                {ipCore.vlnv.name}
              </span>
            )}
          </div>
          {validationErrors.length > 0 && (
            <div
              className="text-sm"
              style={{ color: "var(--vscode-errorForeground)" }}
            >
              {validationErrors.length} validation error(s)
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {parseError ? (
          <div className="flex-1 flex items-center justify-center">
            <div
              className="px-4 py-3 rounded max-w-2xl"
              style={{
                background: "var(--vscode-inputValidation-errorBackground)",
                border: "1px solid var(--vscode-inputValidation-errorBorder)",
                color: "var(--vscode-errorForeground)",
              }}
            >
              <p className="font-semibold mb-2">Parse Error</p>
              <p className="text-sm">{parseError}</p>
            </div>
          </div>
        ) : !ipCore ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <p style={{ color: "var(--vscode-descriptionForeground)" }}>
                No IP core loaded
              </p>
              <p
                className="text-xs mt-2"
                style={{
                  color: "var(--vscode-descriptionForeground)",
                  opacity: 0.6,
                }}
              >
                Waiting for data from extension...
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Sidebar backdrop for mobile */}
            {sidebarOpen && (
              <div
                className="sidebar-backdrop active"
                onClick={() => setSidebarOpen(false)}
              />
            )}
            <NavigationSidebar
              selectedSection={selectedSection}
              onNavigate={navigate}
              ipCore={{ ...ipCore, imports }}
              isFocused={focusedPanel === "left"}
              onFocus={() => setFocusedPanel("left")}
              panelRef={leftPanelRef}
              className={sidebarOpen ? 'sidebar-open' : ''}
            />
            <EditorPanel
              selectedSection={selectedSection}
              ipCore={ipCore}
              imports={imports}
              onUpdate={updateIpCore}
              isFocused={focusedPanel === "right"}
              onFocus={() => setFocusedPanel("right")}
              panelRef={rightPanelRef}
              highlight={highlight}
            />
          </>
        )}
      </div>

      {/* Validation errors panel */}
      {validationErrors.length > 0 && (
        <div
          className="p-2"
          style={{
            borderTop: "1px solid var(--vscode-panel-border)",
            background: "var(--vscode-inputValidation-warningBackground)",
          }}
        >
          <p className="text-sm font-semibold mb-1">
            Reference Validation Errors:
          </p>
          <ul className="text-xs list-disc list-inside">
            {validationErrors.map((error, idx) => (
              <li
                key={idx}
                className="cursor-pointer hover:underline"
                onClick={() => {
                  navigate(error.section);
                  setHighlight({
                    entityName: error.entityName,
                    field: error.field,
                  });
                  setFocusedPanel("right");
                }}
              >
                {error.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

// Mount the app
const container = document.getElementById("ipcore-root");
if (container) {
  const root = createRoot(container);
  root.render(<IpCoreApp />);
}
