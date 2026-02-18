import React, { useState, useEffect } from "react";

interface ShortcutItem {
  keys: string;
  description: string;
}

interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutItem[];
}

const REGISTER_SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Bit Field Visualizer",
    shortcuts: [
      { keys: "Shift + Drag", description: "Resize or create field" },
      { keys: "Ctrl/⌘ + Drag", description: "Move field (translate)" },
      { keys: "Click bit", description: "Toggle bit value (0/1)" },
    ],
  },
  {
    title: "Fields Table",
    shortcuts: [
      { keys: "↑ / ↓ (or j / k)", description: "Navigate rows" },
      { keys: "← / → (or h / l)", description: "Navigate columns" },
      { keys: "Enter / e", description: "Edit cell" },
      { keys: "o / O", description: "Insert field below/above" },
      { keys: "d / Del", description: "Delete field" },

      { keys: "Alt + ↑/↓ (or j/k)", description: "Move field up/down" },
    ],
  },
];

const MEMORY_MAP_SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Address Map Visualizer",
    shortcuts: [{ keys: "Click block", description: "Select block" }],
  },
  {
    title: "Blocks Table",
    shortcuts: [
      { keys: "↑ / ↓ (or j / k)", description: "Navigate rows" },
      { keys: "← / → (or h / l)", description: "Navigate columns" },
      { keys: "Enter / e", description: "Edit cell" },
      { keys: "o / O", description: "Insert block below/above" },
      { keys: "d / Del", description: "Delete block" },
      { keys: "Alt + ↑/↓ (or j/k)", description: "Move block up/down" },
    ],
  },
];

const BLOCK_VIEW_SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Register Map Visualizer",
    shortcuts: [
      { keys: "Ctrl/⌘ + Drag", description: "Move register (reorder)" },
      { keys: "Click register", description: "Select register" },
    ],
  },
  {
    title: "Registers Table",
    shortcuts: [
      { keys: "↑ / ↓ (or j / k)", description: "Navigate rows" },
      { keys: "← / → (or h / l)", description: "Navigate columns" },
      { keys: "Enter / e", description: "Edit cell" },
      { keys: "o / O", description: "Insert register below/above" },
      { keys: "Shift + A / I", description: "Insert array below/above" },
      { keys: "d / Del", description: "Delete register" },
      { keys: "Alt + ↑/↓ (or j/k)", description: "Move register up/down" },
    ],
  },
];

const ARRAY_VIEW_SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Array Properties",
    shortcuts: [
      { keys: "Tab", description: "Navigate between name/count/stride fields" },
    ],
  },
  {
    title: "Nested Registers Table",
    shortcuts: [
      { keys: "↑ / ↓ (or j / k)", description: "Navigate rows" },
      { keys: "o / O", description: "Insert register below/above" },
      { keys: "d / Del", description: "Delete register" },
    ],
  },
];

const OUTLINE_SHORTCUTS: ShortcutGroup[] = [
  {
    title: "Outline Navigation",
    shortcuts: [
      { keys: "↑ / ↓ (or j / k)", description: "Navigate item" },
      { keys: "Enter / Space", description: "Toggle expand/collapse" },
      { keys: "→ (or l)", description: "Focus Details Panel" },
      { keys: "F2 / e", description: "Rename item" },
    ],
  },
];

interface KeyboardShortcutsButtonProps {
  context: "register" | "block" | "memoryMap" | "outline" | "array";
}

export const KeyboardShortcutsButton: React.FC<
  KeyboardShortcutsButtonProps
> = ({ context }) => {
  const [isOpen, setIsOpen] = useState(false);

  // Get shortcuts based on context
  const getShortcuts = (): ShortcutGroup[] => {
    switch (context) {
      case "register":
        return REGISTER_SHORTCUTS;
      case "memoryMap":
        return MEMORY_MAP_SHORTCUTS;
      case "block":
        return BLOCK_VIEW_SHORTCUTS;
      case "array":
        return ARRAY_VIEW_SHORTCUTS;
      case "outline":
        return OUTLINE_SHORTCUTS;
      default:
        return [];
    }
  };

  // Listen for '?' key to toggle modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return;
        }
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === "Escape" && isOpen) {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const shortcuts = getShortcuts();

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 w-10 h-10 rounded-full flex items-center justify-center z-50 shadow-lg transition-all hover:scale-110"
        style={{
          background: "var(--vscode-button-background)",
          color: "var(--vscode-button-foreground)",
          border: "none",
          cursor: "pointer",
        }}
        title="Keyboard Shortcuts (?)"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M6 8h.01M10 8h.01M14 8h.01M18 8h.01M8 12h.01M12 12h.01M16 12h.01M7 16h10" />
        </svg>
      </button>

      {/* Modal */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0, 0, 0, 0.5)" }}
          onClick={() => setIsOpen(false)}
        >
          <div
            className="rounded-lg shadow-2xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto"
            style={{
              background: "var(--vscode-editor-background)",
              border: "1px solid var(--vscode-widget-border)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-3 border-b"
              style={{ borderColor: "var(--vscode-widget-border)" }}
            >
              <h2
                className="text-lg font-semibold"
                style={{ color: "var(--vscode-foreground)" }}
              >
                Keyboard Shortcuts
              </h2>
              <button
                onClick={() => setIsOpen(false)}
                className="w-8 h-8 rounded flex items-center justify-center hover:bg-opacity-10"
                style={{
                  background: "transparent",
                  color: "var(--vscode-foreground)",
                  border: "none",
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              {shortcuts.map((group, groupIdx) => (
                <div key={groupIdx}>
                  <h3
                    className="text-sm font-medium mb-2 opacity-70"
                    style={{ color: "var(--vscode-foreground)" }}
                  >
                    {group.title}
                  </h3>
                  <div className="space-y-1">
                    {group.shortcuts.map((shortcut, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between py-1.5 px-2 rounded"
                        style={{
                          background:
                            idx % 2 === 0
                              ? "transparent"
                              : "var(--vscode-list-hoverBackground)",
                        }}
                      >
                        <span
                          className="text-sm"
                          style={{ color: "var(--vscode-foreground)" }}
                        >
                          {shortcut.description}
                        </span>
                        <kbd
                          className="px-2 py-0.5 rounded text-xs font-mono"
                          style={{
                            background: "var(--vscode-badge-background)",
                            color: "var(--vscode-badge-foreground)",
                          }}
                        >
                          {shortcut.keys}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Footer */}
            <div
              className="px-4 py-2 text-xs opacity-50 border-t text-center"
              style={{
                color: "var(--vscode-foreground)",
                borderColor: "var(--vscode-widget-border)",
              }}
            >
              Press{" "}
              <kbd
                className="px-1 rounded"
                style={{ background: "var(--vscode-badge-background)" }}
              >
                ?
              </kbd>{" "}
              to toggle this dialog
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default KeyboardShortcutsButton;
