import React, { useEffect, useRef, useState, useCallback } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { createRoot } from "react-dom/client";
import Outline, { type OutlineHandle } from "./components/Outline";
import DetailsPanel, {
  type DetailsPanelHandle,
} from "./components/DetailsPanel";
import { vscode } from "./vscode";
import { useMemoryMapState } from "./hooks/useMemoryMapState";
import { useSelection, type Selection } from "./hooks/useSelection";
import { useYamlSync } from "./hooks/useYamlSync";
import { YamlPathResolver, type YamlPath } from "./services/YamlPathResolver";
import { YamlService } from "./services/YamlService";
import type {
  NormalizedRegister,
  NormalizedRegisterArray,
} from "./services/DataNormalizer";
import { BitFieldUtils } from "./utils/BitFieldUtils";
import "./index.css";

/**
 * Main application component
 */
const App = () => {
  // Sidebar toggle state for mobile
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // State management hooks
  const {
    memoryMap,
    rawText,
    rawTextRef,
    parseError,
    fileName,
    updateFromYaml,
    updateRawText,
  } = useMemoryMapState();
  const {
    selectedId,
    selectedType,
    selectedObject,
    breadcrumbs,
    selectionMeta,
    selectionRef,
    handleSelect,
    goBack,
  } = useSelection();

  // VSCode sync hook
  const { sendUpdate, sendCommand } = useYamlSync(vscode, updateFromYaml);

  useEffect(() => {
    vscode?.postMessage({ type: "ready" });
  }, []);

  // Local state
  const [activeTab, setActiveTab] = useState<"properties" | "yaml">(
    "properties",
  );
  const didInitSelectionRef = useRef(false);
  const outlineRef = useRef<OutlineHandle | null>(null);
  const detailsRef = useRef<DetailsPanelHandle | null>(null);

  // Mouse back button listener for navigation history
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      // Mouse button 3 = back button, button 4 = forward button
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      }
    };

    window.addEventListener("mousedown", handleMouseDown);
    return () => window.removeEventListener("mousedown", handleMouseDown);
  }, [goBack]);

  /**
   * Resolve selection from the current memory map after updates
   */
  const resolveFromSelection = useCallback(
    (
      selection: Selection | null,
    ): {
      type: Selection["type"];
      object: unknown;
      breadcrumbs: string[];
    } | null => {
      if (!selection || !memoryMap) {
        return null;
      }

      if (selection.type === "memoryMap") {
        return {
          type: "memoryMap",
          object: memoryMap,
          breadcrumbs: [memoryMap.name || "Memory Map"],
        };
      }

      // Selection paths are YAML-style: ['addressBlocks', blockIndex, ...]
      const blockIndex = typeof selection.path[1] === "number" ? selection.path[1] : null;
      if (blockIndex === null) {
        return null;
      }
      const block = memoryMap.address_blocks?.[blockIndex];
      if (!block) {
        return null;
      }

      if (selection.type === "block") {
        return {
          type: "block",
          object: block,
          breadcrumbs: [memoryMap.name || "Memory Map", block.name],
        };
      }

      const blockRegs = ((block as any).registers ?? []) as Array<
        NormalizedRegister | NormalizedRegisterArray
      >;

      if (selection.type === "array") {
        const regIndex = typeof selection.path[3] === "number" ? selection.path[3] : null;
        if (regIndex === null) {
          return null;
        }
        const node = blockRegs[regIndex];
        if (node && (node as any).__kind === "array") {
          const registerArray = node as NormalizedRegisterArray;
          return {
            type: "array",
            object: registerArray,
            breadcrumbs: [memoryMap.name || "Memory Map", block.name, registerArray.name],
          };
        }
        return null;
      }

      if (selection.type === "register") {
        // Direct register: ['addressBlocks', b, 'registers', r]
        if (selection.path.length === 4) {
          const regIndex = typeof selection.path[3] === "number" ? selection.path[3] : null;
          if (regIndex === null) {
            return null;
          }
          const node = blockRegs[regIndex];
          if (!node || (node as any).__kind === "array") {
            return null;
          }
          const reg = node as NormalizedRegister;
          return {
            type: "register",
            object: reg,
            breadcrumbs: [memoryMap.name || "Memory Map", block.name, reg.name],
          };
        }

        // Nested register inside array: ['addressBlocks', b, 'registers', r, 'registers', rr]
        if (selection.path.length === 6) {
          const arrayIndex = typeof selection.path[3] === "number" ? selection.path[3] : null;
          const nestedIndex =
            typeof selection.path[5] === "number" ? selection.path[5] : null;
          if (arrayIndex === null || nestedIndex === null) {
            return null;
          }
          const node = blockRegs[arrayIndex];
          if (!node || (node as any).__kind !== "array") {
            return null;
          }
          const registerArray = node as NormalizedRegisterArray;
          const reg = registerArray.registers?.[nestedIndex];
          if (!reg) {
            return null;
          }
          return {
            type: "register",
            object: reg,
            breadcrumbs: [
              memoryMap.name || "Memory Map",
              block.name,
              registerArray.name,
              reg.name,
            ],
          };
        }

        return null;
      }

      return null;
    },
    [memoryMap],
  );

  /**
   * Handle updates from DetailsPanel
   */
  const handleUpdate = useCallback(
    (path: YamlPath, value: unknown) => {
      const selection = selectionRef.current;
      if (!selection) {
        return;
      }

      const currentText = rawTextRef.current;
      const rootObj = YamlService.safeParse(currentText);
      if (!rootObj) {
        console.warn("Cannot apply update: YAML parse failed");
        return;
      }

      const { root, selectionRootPath } = YamlPathResolver.getMapRootInfo(rootObj);

      // Handle field operations
      if (path[0] === "__op" && selection.type === "register") {
        handleFieldOperations(path, value, root, selectionRootPath, selection);
        const newText = YamlService.dump(root);
        updateRawText(newText);
        sendUpdate(newText);
        return;
      }

      // Handle regular property updates
      const fullPath: YamlPath = [...selectionRootPath, ...selection.path, ...path];
      try {
        YamlPathResolver.setAtPath(root, fullPath, value);
        const newText = YamlService.dump(root);
        updateRawText(newText);
        sendUpdate(newText);
      } catch (err) {
        console.warn("Failed to apply update:", err);
      }
    },
    [sendUpdate, updateRawText],
  );

  /**
   * Handle field add/delete/move operations
   * NOTE: This is a simplified version - full implementation would be in a separate service
   */
  const handleFieldOperations = (
    path: YamlPath,
    value: unknown,
    root: unknown,
    selectionRootPath: YamlPath,
    selection: Selection,
  ) => {
    const operationType = String(path[1] ?? "");
    const payload = (value ?? {}) as Record<string, unknown>;
    const registerYamlPath: YamlPath = [...selectionRootPath, ...selection.path];
    const fieldsPath: YamlPath = [...registerYamlPath, "fields"];
    const current = YamlPathResolver.getAtPath(root, fieldsPath);
    if (!Array.isArray(current)) {
      YamlPathResolver.setAtPath(root, fieldsPath, []);
    }
    const fieldsArr = (YamlPathResolver.getAtPath(root, fieldsPath) ??
      []) as Record<string, unknown>[];
    if (!Array.isArray(fieldsArr)) {
      return;
    }

    if (operationType === "field-add") {
      const afterIndex =
        typeof payload.afterIndex === "number" ? payload.afterIndex : -1;
      const insertIndex = Math.max(
        0,
        Math.min(fieldsArr.length, afterIndex + 1),
      );
      const currentFields = ((selection.object as Record<string, unknown>)?.fields as unknown[]) ?? [];
      const used = new Set<number>();
      for (const field of currentFields) {
        const o = Number((field as Record<string, unknown>)?.bit_offset ?? 0);
        const w = Number((field as Record<string, unknown>)?.bit_width ?? 1);
        for (let b = o; b < o + w; b++) {
          used.add(b);
        }
      }
      let lsb = 0;
      while (used.has(lsb) && lsb < 32) {
        lsb++;
      }
      const bits = `[${lsb}:${lsb}]`;

      fieldsArr.splice(insertIndex, 0, {
        name: payload.name ?? "NEW_FIELD",
        bits,
        access: payload.access ?? "read-write",
        description: payload.description ?? "",
      });
    }

    if (operationType === "field-delete") {
      const index = typeof payload.index === "number" ? payload.index : -1;
      if (index >= 0 && index < fieldsArr.length) {
        fieldsArr.splice(index, 1);
      }
    }

    if (operationType === "field-move") {
      const index = typeof payload.index === "number" ? payload.index : -1;
      const delta = typeof payload.delta === "number" ? payload.delta : 0;
      const next = index + delta;
      if (
        index >= 0 &&
        next >= 0 &&
        index < fieldsArr.length &&
        next < fieldsArr.length
      ) {
        // Swap fields in array
        const tmp = fieldsArr[index];
        fieldsArr[index] = fieldsArr[next];
        fieldsArr[next] = tmp;

        // Recalculate bit offsets for ALL fields after swapping
        // Important: Create clean field objects to avoid modifying shared references
        let offset = 0;
        for (let i = 0; i < fieldsArr.length; i++) {
          const field = fieldsArr[i];

          // Parse width from bits string (primary source of truth in YAML)
          let width = 1; // default
          if (typeof field?.bits === "string") {
            const parsed = BitFieldUtils.parseBitsLike(field.bits);
            if (parsed && parsed.bit_width > 0) {
              width = parsed.bit_width;
            }
          }
          // Fall back to bit_width property if bits is not available
          else if (Number.isFinite(field?.bit_width as number) && (field.bit_width as number) > 0) {
            width = Number(field.bit_width);
          }
          width = Math.max(1, Math.min(32, Math.trunc(width)));

          // Replace field with clean object containing only YAML-persisted properties
          fieldsArr[i] = {
            name: field.name,
            bits: BitFieldUtils.formatBitsLike(offset, width),
            access: field.access,
            reset_value: field.reset_value,
            description: field.description,
            enumerated_values: field.enumerated_values,
          };

          offset += width;
        }
      }
    }
  };

  /**
   * Auto-select root on first load and maintain selection after updates
   */
  useEffect(() => {
    if (!memoryMap) {
      return;
    }

    if (!didInitSelectionRef.current) {
      handleSelect({
        id: "root",
        type: "memoryMap",
        object: memoryMap,
        breadcrumbs: [memoryMap.name || "Memory Map"],
        path: [],
      });
      didInitSelectionRef.current = true;
    } else {
      const resolved = resolveFromSelection(selectionRef.current);
      if (resolved) {
        handleSelect({
          ...selectionRef.current!,
          type: resolved.type,
          object: resolved.object,
          breadcrumbs: resolved.breadcrumbs,
        });
      }
    }
  }, [memoryMap, handleSelect, resolveFromSelection]);

  /**
   * Keyboard navigation (Ctrl+H for outline, Ctrl+L for details)
   */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const keyLower = (e.key || "").toLowerCase();
      if (!e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      if (keyLower !== "h" && keyLower !== "l") {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (keyLower === "h") {
        outlineRef.current?.focus();
        return;
      }
      if (keyLower === "l") {
        detailsRef.current?.focus();
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  /**
   * Render error state
   */
  if (parseError) {
    return (
      <div className="flex items-center justify-center h-screen vscode-surface">
        <div className="text-center p-8">
          <span className="codicon codicon-error text-6xl mb-4 block opacity-50"></span>
          <h2 className="text-xl font-semibold mb-2">Parse Error</h2>
          <p className="text-sm opacity-75">{parseError}</p>
        </div>
      </div>
    );
  }

  /**
   * Render loading state
   */
  if (!memoryMap) {
    return (
      <div className="flex items-center justify-center h-screen vscode-surface">
        <div className="text-center">
          <span className="codicon codicon-loading codicon-modifier-spin text-4xl opacity-50"></span>
          <p className="mt-4 text-sm opacity-75">Loading memory map...</p>
        </div>
      </div>
    );
  }

  /**
   * Main UI
   */
  return (
    <>
      <header
        className="flex items-center justify-between px-6 py-3 shrink-0"
        style={{ borderBottom: "1px solid var(--vscode-panel-border)" }}
      >
        <div className="flex items-center gap-4 flex-1 overflow-hidden">
          {/* Mobile sidebar toggle */}
          <button
            className="sidebar-toggle-btn p-2 rounded-md transition-colors vscode-icon-button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            title="Toggle sidebar"
          >
            <span className="codicon codicon-menu"></span>
          </button>
          <h1 className="text-lg font-semibold shrink-0">
            FPGA Memory Map Editor
          </h1>
          <div className="flex items-center gap-1 text-sm opacity-75 overflow-hidden">
            <span className="codicon codicon-file text-[16px]"></span>
            <span className="truncate">{fileName || "Untitled"}</span>
            {breadcrumbs.length > 1 && (
              <>
                <span className="codicon codicon-chevron-right text-[16px]"></span>
                <span
                  className="font-medium px-2 py-0.5 rounded vscode-surface-alt"
                  style={{ border: "1px solid var(--vscode-panel-border)" }}
                >
                  {breadcrumbs[breadcrumbs.length - 1]}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="p-2 rounded-md transition-colors vscode-icon-button"
            onClick={() => sendCommand("save")}
            title="Save"
          >
            <span className="codicon codicon-save"></span>
          </button>
          <button
            className="p-2 rounded-md transition-colors vscode-icon-button"
            onClick={() => sendCommand("validate")}
            title="Validate"
          >
            <span className="codicon codicon-check"></span>
          </button>
          <div
            className="h-6 w-px mx-1"
            style={{ background: "var(--vscode-panel-border)" }}
          ></div>
          <button
            className="p-2 rounded-md transition-colors vscode-icon-button"
            title="Export Header"
          >
            <span className="codicon codicon-code"></span>
          </button>
          <button
            className="p-2 rounded-md transition-colors vscode-icon-button"
            title="Documentation"
          >
            <span className="codicon codicon-book"></span>
          </button>
        </div>
      </header>
      <main className="flex-1 flex overflow-hidden">
        {/* Sidebar backdrop for mobile */}
        {sidebarOpen && (
          <div
            className="sidebar-backdrop active"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <aside
          className={`sidebar flex flex-col shrink-0 overflow-y-auto ${sidebarOpen ? "sidebar-open" : ""}`}
        >
          <Outline
            ref={outlineRef}
            memoryMap={memoryMap}
            selectedId={selectedId}
            onSelect={handleSelect}
            onRename={(path, newName) => {
              // path is already the full path to the 'name' property
              // e.g., ['addressBlocks', 0, 'name'] for a block
              const currentText = rawTextRef.current;
              const rootObj = YamlService.safeParse(currentText);
              if (!rootObj) {
                console.warn("Cannot apply rename: YAML parse failed");
                return;
              }
              const { root, selectionRootPath } =
                YamlPathResolver.getMapRootInfo(rootObj);
              const fullPath = [...selectionRootPath, ...path];
              try {
                YamlPathResolver.setAtPath(root, fullPath, newName);
                const newText = YamlService.dump(root);
                updateRawText(newText);
                sendUpdate(newText);
              } catch (err) {
                console.warn("Failed to apply rename:", err);
              }
            }}
          />
        </aside>
        {activeTab === "yaml" ? (
          <section className="flex-1 vscode-surface overflow-auto min-w-0">
            <div className="p-6">
              <pre className="font-mono text-sm">{rawText}</pre>
            </div>
          </section>
        ) : (
          <section className="flex-1 overflow-hidden min-w-0">
            <DetailsPanel
              ref={detailsRef}
              selectedType={selectedType}
              selectedObject={selectedObject}
              selectionMeta={selectionMeta}
              onUpdate={handleUpdate}
              onNavigateToRegister={(regIndex) => {
                // Navigate to register in Outline when clicking on visualizer
                if (!memoryMap || !selectionRef.current) {
                  return;
                }

                // CASE 1: Block View (Direct registers/arrays)
                if (selectionRef.current.type === "block") {
                  const currentPath = selectionRef.current.path || [];
                  const block = selectedObject as Record<string, unknown>;
                  const registers = (block?.registers as unknown[]) || [];
                  const reg = registers[regIndex] as Record<string, unknown>;
                  if (!reg) {return;}

                  // Determine if it's an array or register
                  const isArray = reg.__kind === "array";
                  const newPath = [...currentPath, "registers", regIndex];

                  // Outline uses different ID schemes for arrays vs registers
                  const idSuffix = isArray
                    ? `-arrreg-${regIndex}`
                    : `-reg-${regIndex}`;

                  handleSelect({
                    id: `${selectionRef.current.id}${idSuffix}`,
                    type: isArray ? "array" : "register",
                    object: reg,
                    breadcrumbs: [
                      ...(selectionRef.current.breadcrumbs || []),
                      String(reg.name ?? `Register ${regIndex}`),
                    ],
                    path: newPath,
                    // Block children (top-level) absolute address is calculated in Outline, but we can approximate or omit if Outline recalculates?
                    // Usually safe to omit if DetailsPanel Recalcs or if Outline pass provides it.
                    // For consistency, let's leave meta undefined (or copy from existing logic which didn't set it? Existing logic DID NOT set meta).
                  });
                  return;
                }

                // CASE 2: Array Element View (Nested registers)
                // When masquerading as a Block for an Array Element, clicking a register should select the template register in the Outline under that element.
                if (selectionRef.current.type === "array") {
                  const arr = selectedObject as Record<string, unknown>; // NormalizedRegisterArray with meta
                  const registers = (arr.registers as unknown[]) || [];
                  const reg = registers[regIndex] as Record<string, unknown>;
                  if (!reg) {return;}

                  // Path logic verified from Outline.tsx: [...arrayPath, 'registers', childIndex]
                  const newPath = [
                    ...(selectionRef.current.path || []),
                    "registers",
                    regIndex,
                  ];

                  // ID suffix logic verified from Outline.tsx: `${elementId}-reg-${childIndex}`
                  const id = `${selectionRef.current.id}-reg-${regIndex}`;

                  // Calculate absolute address for the specific child
                  const elementBase = (arr.__element_base as number) ?? 0;
                  const absoluteAddr = elementBase + ((reg.address_offset as number) ?? 0);

                  handleSelect({
                    id,
                    type: "register",
                    object: reg,
                    breadcrumbs: [
                      ...(selectionRef.current.breadcrumbs || []),
                      String(reg.name ?? `Register ${regIndex}`),
                    ],
                    path: newPath,
                    meta: {
                      absoluteAddress: absoluteAddr,
                      relativeOffset: (reg.address_offset as number) ?? 0,
                    },
                  });
                  return;
                }
              }}
              onNavigateToBlock={(blockIndex) => {
                // Navigate to address block in Outline
                if (!memoryMap || !memoryMap.address_blocks) {return;}
                const block = memoryMap.address_blocks[blockIndex];
                if (!block) {return;}

                handleSelect({
                  id: `block-${blockIndex}`,
                  type: "block",
                  object: block,
                  breadcrumbs: [
                    memoryMap.name || "Memory Map",
                    block.name || `Block ${blockIndex}`,
                  ],
                  path: ["addressBlocks", blockIndex],
                });
              }}
            />
          </section>
        )}
      </main>
    </>
  );
};

/**
 * Error boundary for catching React errors
 */
class ErrorBoundary extends React.Component<
  { children: ReactNode },
  { error: unknown; info: unknown }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null, info: null };
  }
  static getDerivedStateFromError(error: unknown) {
    return { error, info: null };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    this.setState({ error, info });
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            background: "#fff0f0",
            color: "#b91c1c",
            padding: 32,
            fontFamily: "monospace",
          }}
        >
          <h2 style={{ fontWeight: "bold" }}>UI Error</h2>
          <div>{(this.state.error as Error)?.message || String(this.state.error)}</div>
          {!!this.state.info && (
            <pre style={{ marginTop: 16, fontSize: 12 }}>
              {(this.state.info as { componentStack?: string })?.componentStack}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Application bootstrap
 */
const rootElement = document.getElementById("root");
if (rootElement) {
  const root = createRoot(rootElement);
  root.render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}
