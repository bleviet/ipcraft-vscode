import React, { useState, useRef, useEffect, useCallback } from "react";
import { vscode } from "../../../vscode";

interface BusPort {
  name: string;
  width?: number;
  direction?: string;
  presence?: string;
}

interface BusInterface {
  name: string;
  type: string;
  mode: string;
  physicalPrefix?: string;
  associatedClock?: string;
  associatedReset?: string;
  memoryMapRef?: string;
  useOptionalPorts?: string[];
  portWidthOverrides?: Record<string, number>;
  portNameOverrides?: Record<string, string>;
  array?: {
    count: number;
    indexStart?: number;
    namingPattern?: string;
    physicalPrefixPattern?: string;
  };
}

interface Clock {
  name: string;
  physicalPort?: string;
  frequency?: string;
  direction?: string;
}

interface Reset {
  name: string;
  physicalPort?: string;
  polarity?: string;
  direction?: string;
}

interface BusInterfacesEditorProps {
  busInterfaces: BusInterface[];
  busLibrary?: Record<string, { ports?: BusPort[] }>;
  clocks?: Clock[];
  resets?: Reset[];
  onUpdate: (path: Array<string | number>, value: any) => void;
  highlight?: { entityName: string; field: string };
  imports?: { memoryMaps?: any[] };
}

// Consistent text styles
const TEXT_STYLES = {
  label: { opacity: 0.6 },
  value: { fontFamily: "var(--vscode-editor-font-family, monospace)" },
  muted: { opacity: 0.7 },
};

/**
 * Get effective ports for a bus interface based on library definition and overrides
 */
function getEffectivePorts(
  bus: BusInterface,
  busLibrary: Record<string, { ports?: BusPort[] }> | undefined,
): BusPort[] {
  if (!busLibrary || !bus.type || !busLibrary[bus.type]) {
    return [];
  }

  const libraryDef = busLibrary[bus.type];
  const libraryPorts = libraryDef.ports || [];
  const optionalPorts = bus.useOptionalPorts || [];
  const widthOverrides = bus.portWidthOverrides || {};

  return libraryPorts
    .filter((port) => {
      if (port.presence === "required") {
        return true;
      }
      if (port.presence === "optional" && optionalPorts.includes(port.name)) {
        return true;
      }
      return false;
    })
    .map((port) => ({
      ...port,
      width: widthOverrides[port.name] ?? port.width,
      direction:
        bus.mode === "slave" && port.direction
          ? port.direction === "in"
            ? "out"
            : port.direction === "out"
              ? "in"
              : port.direction
          : port.direction,
    }));
}

/**
 * Bus Interfaces Editor - Clean consistent styling
 */
export const BusInterfacesEditor: React.FC<BusInterfacesEditorProps> = ({
  busInterfaces,
  busLibrary,
  imports,
  clocks = [],
  resets = [],
  onUpdate,
  highlight,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedIndexes, setExpandedIndexes] = useState<Set<number>>(
    new Set(),
  );
  const [expandAll, setExpandAll] = useState(false);
  const [editingPrefix, setEditingPrefix] = useState<number | null>(null);
  const [draftPrefix, setDraftPrefix] = useState("");
  const [editingPortName, setEditingPortName] = useState<{
    busIndex: number;
    portName: string;
  } | null>(null);
  const [draftPortName, setDraftPortName] = useState("");
  // Port-level navigation state
  const [selectedPortIndex, setSelectedPortIndex] = useState(0);
  const [selectedColumn, setSelectedColumn] = useState<"name" | "width">(
    "name",
  );
  const [editingPortWidth, setEditingPortWidth] = useState<{
    busIndex: number;
    portName: string;
  } | null>(null);
  const [draftPortWidth, setDraftPortWidth] = useState("");
  // Array field editing
  const [editingArrayField, setEditingArrayField] = useState<{
    busIndex: number;
    field: "count" | "indexStart" | "namingPattern" | "physicalPrefixPattern";
  } | null>(null);
  const [draftArrayValue, setDraftArrayValue] = useState("");
  // Bus field editing
  const [editingBusField, setEditingBusField] = useState<{
    busIndex: number;
    field: "name" | "type" | "mode";
  } | null>(null);
  const [draftBusValue, setDraftBusValue] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const toggleExpand = useCallback((index: number) => {
    setExpandedIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const toggleExpandAll = useCallback(() => {
    if (expandAll) {
      setExpandedIndexes(new Set());
    } else {
      setExpandedIndexes(new Set(busInterfaces.map((_, i) => i)));
    }
    setExpandAll(!expandAll);
  }, [expandAll, busInterfaces]);

  const startEditPrefix = useCallback(
    (index: number, currentPrefix: string) => {
      setEditingPrefix(index);
      setDraftPrefix(currentPrefix || "");
    },
    [],
  );

  const savePrefix = useCallback(
    (index: number) => {
      onUpdate(["busInterfaces", index, "physicalPrefix"], draftPrefix);
      setEditingPrefix(null);
      setDraftPrefix("");
      setTimeout(() => containerRef.current?.focus(), 0);
    },
    [draftPrefix, onUpdate],
  );

  const cancelEditPrefix = useCallback(() => {
    setEditingPrefix(null);
    setDraftPrefix("");
    setTimeout(() => containerRef.current?.focus(), 0);
  }, []);

  // Port name editing - only edit the suffix, not the prefix
  const getPortSuffix = (bus: BusInterface, portName: string): string => {
    if (bus.portNameOverrides?.[portName]) {
      return bus.portNameOverrides[portName];
    }
    return portName.toLowerCase();
  };

  const getPhysicalName = (bus: BusInterface, portName: string): string => {
    return `${bus.physicalPrefix || ""}${getPortSuffix(bus, portName)}`;
  };

  const startEditPortName = useCallback(
    (busIndex: number, portName: string, currentSuffix: string) => {
      setEditingPortName({ busIndex, portName });
      setDraftPortName(currentSuffix);
    },
    [],
  );

  const savePortName = useCallback(
    (busIndex: number, portName: string) => {
      const defaultSuffix = portName.toLowerCase();
      const bus = busInterfaces[busIndex];
      const newOverrides = { ...(bus.portNameOverrides || {}) };

      if (draftPortName === defaultSuffix || draftPortName === "") {
        delete newOverrides[portName];
      } else {
        newOverrides[portName] = draftPortName;
      }

      onUpdate(
        ["busInterfaces", busIndex, "portNameOverrides"],
        Object.keys(newOverrides).length > 0 ? newOverrides : undefined,
      );
      setEditingPortName(null);
      setDraftPortName("");
      setTimeout(() => containerRef.current?.focus(), 0);
    },
    [busInterfaces, draftPortName, onUpdate],
  );

  const cancelEditPortName = useCallback(() => {
    setEditingPortName(null);
    setDraftPortName("");
    setTimeout(() => containerRef.current?.focus(), 0);
  }, []);

  // Width editing
  const startEditPortWidth = useCallback(
    (busIndex: number, portName: string, currentWidth: number) => {
      setEditingPortWidth({ busIndex, portName });
      setDraftPortWidth(String(currentWidth));
    },
    [],
  );

  const savePortWidth = useCallback(
    (busIndex: number, portName: string, defaultWidth: number) => {
      const bus = busInterfaces[busIndex];
      const newOverrides = { ...(bus.portWidthOverrides || {}) };
      const newWidth = parseInt(draftPortWidth, 10);

      if (isNaN(newWidth) || newWidth === defaultWidth) {
        delete newOverrides[portName];
      } else {
        newOverrides[portName] = newWidth;
      }

      onUpdate(
        ["busInterfaces", busIndex, "portWidthOverrides"],
        Object.keys(newOverrides).length > 0 ? newOverrides : undefined,
      );
      setEditingPortWidth(null);
      setDraftPortWidth("");
      setTimeout(() => containerRef.current?.focus(), 0);
    },
    [busInterfaces, draftPortWidth, onUpdate],
  );

  const cancelEditPortWidth = useCallback(() => {
    setEditingPortWidth(null);
    setDraftPortWidth("");
    setTimeout(() => containerRef.current?.focus(), 0);
  }, []);

  // Array field editing
  type ArrayField =
    | "count"
    | "indexStart"
    | "namingPattern"
    | "physicalPrefixPattern";

  const startEditArrayField = useCallback(
    (busIndex: number, field: ArrayField, currentValue: string | number) => {
      setEditingArrayField({ busIndex, field });
      setDraftArrayValue(String(currentValue));
    },
    [],
  );

  const saveArrayField = useCallback(
    (busIndex: number) => {
      if (!editingArrayField) {
        return;
      }
      const { field } = editingArrayField;

      if (field === "count" || field === "indexStart") {
        const numValue = parseInt(draftArrayValue, 10);
        if (!isNaN(numValue) && (field === "indexStart" || numValue > 0)) {
          onUpdate(["busInterfaces", busIndex, "array", field], numValue);
        }
      } else {
        // String fields: namingPattern, physicalPrefixPattern
        if (draftArrayValue.trim()) {
          onUpdate(
            ["busInterfaces", busIndex, "array", field],
            draftArrayValue.trim(),
          );
        } else {
          // Remove empty patterns
          onUpdate(["busInterfaces", busIndex, "array", field], undefined);
        }
      }

      setEditingArrayField(null);
      setDraftArrayValue("");
      setTimeout(() => containerRef.current?.focus(), 0);
    },
    [editingArrayField, draftArrayValue, onUpdate],
  );

  const cancelEditArrayField = useCallback(() => {
    setEditingArrayField(null);
    setDraftArrayValue("");
    setTimeout(() => containerRef.current?.focus(), 0);
  }, []);

  // Toggle array configuration
  const toggleArray = useCallback(
    (busIndex: number, hasArray: boolean) => {
      if (hasArray) {
        // Remove array
        onUpdate(["busInterfaces", busIndex, "array"], undefined);
      } else {
        // Add array with default values
        onUpdate(["busInterfaces", busIndex, "array"], {
          count: 2,
          indexStart: 0,
        });
      }
    },
    [onUpdate],
  );

  // Toggle optional port
  const toggleOptionalPort = useCallback(
    (busIndex: number, portName: string, currentlyEnabled: boolean) => {
      const bus = busInterfaces[busIndex];
      const currentOptional = bus.useOptionalPorts || [];

      let newOptional: string[];
      if (currentlyEnabled) {
        newOptional = currentOptional.filter((p) => p !== portName);
      } else {
        newOptional = [...currentOptional, portName];
      }

      onUpdate(
        ["busInterfaces", busIndex, "useOptionalPorts"],
        newOptional.length > 0 ? newOptional : undefined,
      );
    },
    [busInterfaces, onUpdate],
  );

  // Update associated clock/reset
  const updateAssociation = useCallback(
    (
      busIndex: number,
      field: "associatedClock" | "associatedReset",
      value: string,
    ) => {
      onUpdate(["busInterfaces", busIndex, field], value || undefined);
    },
    [onUpdate],
  );

  // Get all optional ports from library
  const getOptionalPorts = useCallback(
    (bus: BusInterface): BusPort[] => {
      if (!busLibrary || !bus.type || !busLibrary[bus.type]) {
        return [];
      }
      const libraryDef = busLibrary[bus.type];
      return (libraryDef.ports || []).filter((p) => p.presence === "optional");
    },
    [busLibrary],
  );

  // Bus interface management
  const addBusInterface = useCallback(() => {
    // Default to AXI4 or the first available type
    const availableTypes = busLibrary ? Object.keys(busLibrary) : [];
    const defaultType = availableTypes.includes("AXI4")
      ? "AXI4"
      : availableTypes[0] || "AXI4";

    const newBus: BusInterface = {
      name: `NEW_INTERFACE_${busInterfaces.length}`,
      type: defaultType,
      mode: "slave",
    };

    onUpdate(["busInterfaces"], [...busInterfaces, newBus]);

    // Auto-select the new interface
    setTimeout(() => {
      setSelectedIndex(busInterfaces.length);
      setExpandedIndexes((prev) => new Set(prev).add(busInterfaces.length));
    }, 50);
  }, [busInterfaces, busLibrary, onUpdate]);

  const removeBusInterface = useCallback(
    (index: number) => {
      const newInterfaces = [...busInterfaces];
      newInterfaces.splice(index, 1);
      onUpdate(["busInterfaces"], newInterfaces);

      // Adjust selection if needed
      if (selectedIndex >= newInterfaces.length) {
        setSelectedIndex(Math.max(0, newInterfaces.length - 1));
      }
    },
    [busInterfaces, selectedIndex, onUpdate],
  );

  // Bus field editing
  type BusField = "name" | "type" | "mode";

  const startEditBusField = useCallback(
    (busIndex: number, field: BusField, currentValue: string) => {
      setEditingBusField({ busIndex, field });
      setDraftBusValue(currentValue);
    },
    [],
  );

  const saveBusField = useCallback(
    (busIndex: number, overrideValue?: string) => {
      if (!editingBusField) {
        return;
      }
      const { field } = editingBusField;

      const valueToSave =
        overrideValue !== undefined ? overrideValue : draftBusValue;

      if (valueToSave.trim()) {
        onUpdate(["busInterfaces", busIndex, field], valueToSave.trim());
      }

      setEditingBusField(null);
      setDraftBusValue("");
      setTimeout(() => containerRef.current?.focus(), 0);
    },
    [editingBusField, draftBusValue, onUpdate],
  );

  const cancelEditBusField = useCallback(() => {
    setEditingBusField(null);
    setDraftBusValue("");
    setTimeout(() => containerRef.current?.focus(), 0);
  }, []);

  const handleBrowseMemoryMap = useCallback(
    (busIndex: number) => {
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
          // Update the memory map reference
          const filePath = message.files[0];
          onUpdate(["busInterfaces", busIndex, "memoryMapRef"], filePath);

          window.removeEventListener("message", handler);
        }
      };
      window.addEventListener("message", handler);
    },
    [onUpdate],
  );

  const handleClearMemoryMap = useCallback(
    (busIndex: number) => {
      onUpdate(["busInterfaces", busIndex, "memoryMapRef"], undefined);
    },
    [onUpdate],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip vim navigation when editing
      if (
        editingPortName !== null ||
        editingPrefix !== null ||
        editingPortWidth !== null ||
        editingArrayField !== null ||
        editingBusField !== null
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      const currentBusExpanded = expandedIndexes.has(selectedIndex);
      const currentBus = busInterfaces[selectedIndex];
      const ports = currentBus ? getEffectivePorts(currentBus, busLibrary) : [];

      // When a bus interface is expanded with ports, use nested navigation
      if (currentBusExpanded && ports.length > 0) {
        if (key === "j" || e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedPortIndex((prev) => Math.min(prev + 1, ports.length - 1));
        } else if (key === "k" || e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedPortIndex((prev) => Math.max(prev - 1, 0));
        } else if (key === "h" || e.key === "ArrowLeft") {
          e.preventDefault();
          setSelectedColumn("name");
        } else if (key === "l" || e.key === "ArrowRight") {
          e.preventDefault();
          setSelectedColumn("width");
        } else if (key === "e") {
          e.preventDefault();
          const port = ports[selectedPortIndex];
          if (port) {
            if (selectedColumn === "name") {
              startEditPortName(
                selectedIndex,
                port.name,
                getPortSuffix(currentBus, port.name),
              );
            } else {
              startEditPortWidth(selectedIndex, port.name, port.width || 1);
            }
          }
        } else if (e.key === "Escape") {
          e.preventDefault();
          toggleExpand(selectedIndex); // Collapse to exit port mode
        } else if (key === "g") {
          e.preventDefault();
          setSelectedPortIndex(0);
        } else if (e.key === "G" && e.shiftKey) {
          e.preventDefault();
          setSelectedPortIndex(ports.length - 1);
        }
      } else {
        // Top-level bus interface navigation
        if (key === "j" || e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((prev) =>
            Math.min(prev + 1, busInterfaces.length - 1),
          );
          setSelectedPortIndex(0); // Reset port selection
        } else if (key === "k" || e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          setSelectedPortIndex(0); // Reset port selection
        } else if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleExpand(selectedIndex);
          setSelectedPortIndex(0); // Reset port selection when expanding
        } else if (key === "g") {
          e.preventDefault();
          setSelectedIndex(0);
        } else if (e.key === "G" && e.shiftKey) {
          e.preventDefault();
          setSelectedIndex(busInterfaces.length - 1);
        } else if (key === "0") {
          e.preventDefault();
          toggleExpandAll();
        } else if (key === "d" && e.ctrlKey) {
          // Delete bus interface with Ctrl+D
          e.preventDefault();
          removeBusInterface(selectedIndex);
        }
      }
    };

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [
    busInterfaces,
    busLibrary,
    selectedIndex,
    selectedPortIndex,
    selectedColumn,
    expandedIndexes,
    toggleExpand,
    toggleExpandAll,
    editingPortName,
    editingPrefix,
    editingPortWidth,
    editingArrayField,
    editingBusField,
    startEditPortName,
    startEditPortWidth,
    removeBusInterface,
  ]);

  // Auto-expand/scroll to highlighted element
  useEffect(() => {
    if (highlight && highlight.entityName) {
      const index = busInterfaces.findIndex(
        (b) => b.name === highlight.entityName,
      );
      if (index !== -1) {
        setSelectedIndex(index);
        setExpandedIndexes((prev) => new Set(prev).add(index));

        // If it's the top level bus, ensure it's in view
        const container = containerRef.current;
        if (container) {
          // Simple scroll attempt - in a real list we might need ref to specific item
          // but since we don't have refs for each item easily, we'll let user find it via selection
          // The selection logic helps.
        }
      }
    }
  }, [highlight, busInterfaces]);

  const isExpanded = (index: number) => expandedIndexes.has(index);

  // Scroll Bus Interface into view
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      const el = container.querySelector(`[data-bus-index="${selectedIndex}"]`);
      el?.scrollIntoView({ block: "nearest" });
    });
  }, [selectedIndex]);

  // Scroll Port into view
  useEffect(() => {
    if (!expandedIndexes.has(selectedIndex)) return;
    const container = containerRef.current;
    if (!container) return;
    requestAnimationFrame(() => {
      const busEl = container.querySelector(
        `[data-bus-index="${selectedIndex}"]`,
      );
      const portEl = busEl?.querySelector(
        `[data-port-index="${selectedPortIndex}"]`,
      );
      portEl?.scrollIntoView({ block: "nearest" });
    });
  }, [selectedPortIndex, selectedIndex, expandedIndexes]);

  const getClockInfo = (clockName: string) =>
    clocks.find((c) => c.name === clockName);
  const getResetInfo = (resetName: string) =>
    resets.find((r) => r.name === resetName);

  return (
    <div
      ref={containerRef}
      className="p-6 space-y-4"
      tabIndex={0}
      style={{ outline: "none" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-medium">Bus Interfaces</h2>
          <p className="text-sm mt-1" style={TEXT_STYLES.muted}>
            {busInterfaces.length} interface(s) ·{" "}
            <span style={{ fontFamily: "monospace", fontSize: "11px" }}>
              j/k navigate · Space expand · h/l column · e edit · 0 toggle all
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={addBusInterface}
            className="px-3 py-1.5 rounded text-sm flex items-center gap-2"
            style={{
              background: "var(--vscode-button-background)",
              color: "var(--vscode-button-foreground)",
            }}
          >
            <span className="codicon codicon-add"></span>
            Add Interface
          </button>
          <button
            onClick={toggleExpandAll}
            className="px-3 py-1.5 rounded text-sm flex items-center gap-2"
            style={{
              background: "var(--vscode-button-secondaryBackground)",
              color: "var(--vscode-button-secondaryForeground)",
            }}
          >
            <span
              className={`codicon codicon-${expandAll ? "collapse-all" : "expand-all"}`}
            ></span>
            {expandAll ? "Collapse All" : "Expand All"}
          </button>
        </div>
      </div>

      {/* Interface list */}
      {busInterfaces.length === 0 ? (
        <div
          className="p-8 text-center rounded text-sm"
          style={{
            background: "var(--vscode-editor-background)",
            border: "1px solid var(--vscode-panel-border)",
            ...TEXT_STYLES.muted,
          }}
        >
          No bus interfaces defined.
        </div>
      ) : (
        <div className="space-y-2">
          {busInterfaces.map((bus, index) => {
            const isSelected = selectedIndex === index;
            const expanded = isExpanded(index);
            const ports = getEffectivePorts(bus, busLibrary);
            const clockInfo = bus.associatedClock
              ? getClockInfo(bus.associatedClock)
              : null;
            const resetInfo = bus.associatedReset
              ? getResetInfo(bus.associatedReset)
              : null;

            return (
              <div
                key={index}
                data-bus-index={index}
                className="rounded overflow-hidden"
                style={{ border: "1px solid var(--vscode-panel-border)" }}
              >
                {/* Header row */}
                <div
                  onClick={() => {
                    setSelectedIndex(index);
                    containerRef.current?.focus();
                  }}
                  onDoubleClick={() => toggleExpand(index)}
                  className="flex items-center gap-3 px-4 py-3 cursor-pointer group"
                  style={{
                    background: isSelected
                      ? "var(--vscode-list-activeSelectionBackground)"
                      : "var(--vscode-editor-background)",
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpand(index);
                    }}
                    className="p-0.5"
                  >
                    <span
                      className={`codicon codicon-chevron-${expanded ? "down" : "right"}`}
                    ></span>
                  </button>

                  <div className="flex-1 min-w-0">
                    {/* Name and badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Name Editing */}
                      {editingBusField?.busIndex === index &&
                      editingBusField?.field === "name" ? (
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={draftBusValue}
                            onChange={(e) => setDraftBusValue(e.target.value)}
                            className="px-1 py-0.5 rounded text-sm font-semibold"
                            style={{
                              background: "var(--vscode-input-background)",
                              border: "1px solid var(--vscode-input-border)",
                              color: "var(--vscode-input-foreground)",
                              outline: "none",
                              width: "200px",
                            }}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === "Enter") {
                                saveBusField(index);
                              } else if (e.key === "Escape") {
                                cancelEditBusField();
                              }
                            }}
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              saveBusField(index);
                            }}
                            className="px-1 py-0.5 rounded text-xs"
                            style={{
                              background: "var(--vscode-button-background)",
                              color: "var(--vscode-button-foreground)",
                            }}
                          >
                            ✓
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelEditBusField();
                            }}
                            className="px-1 py-0.5 rounded text-xs"
                            style={{
                              background:
                                "var(--vscode-button-secondaryBackground)",
                              color: "var(--vscode-button-secondaryForeground)",
                            }}
                          >
                            ✗
                          </button>
                        </div>
                      ) : (
                        <span
                          className="text-sm font-semibold cursor-pointer hover:underline decoration-dotted"
                          style={TEXT_STYLES.value}
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditBusField(index, "name", bus.name);
                          }}
                          title="Click to edit name"
                        >
                          {bus.name}
                        </span>
                      )}

                      {/* Type Editing */}
                      {editingBusField?.busIndex === index &&
                      editingBusField?.field === "type" ? (
                        <select
                          value={draftBusValue}
                          onChange={(e) => saveBusField(index, e.target.value)}
                          className="px-1 py-0.5 rounded text-xs"
                          style={{
                            background: "var(--vscode-input-background)",
                            border: "1px solid var(--vscode-input-border)",
                            color: "var(--vscode-input-foreground)",
                            outline: "none",
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Escape") {
                              cancelEditBusField();
                            }
                          }}
                          onBlur={() => cancelEditBusField()}
                          autoFocus
                        >
                          {busLibrary &&
                            Object.keys(busLibrary).map((type) => (
                              <option key={type} value={type}>
                                {type}
                              </option>
                            ))}
                        </select>
                      ) : (
                        <span
                          className="px-1.5 py-0.5 rounded text-xs cursor-pointer hover:opacity-80"
                          style={{
                            background: "var(--vscode-badge-background)",
                            color: "var(--vscode-badge-foreground)",
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditBusField(index, "type", bus.type);
                          }}
                          title="Click to change type"
                        >
                          {bus.type}
                        </span>
                      )}

                      {/* Mode Editing */}
                      {editingBusField?.busIndex === index &&
                      editingBusField?.field === "mode" ? (
                        <select
                          value={draftBusValue}
                          onChange={(e) => saveBusField(index, e.target.value)}
                          className="px-1 py-0.5 rounded text-xs"
                          style={{
                            background: "var(--vscode-input-background)",
                            border: "1px solid var(--vscode-input-border)",
                            color: "var(--vscode-input-foreground)",
                            outline: "none",
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Escape") {
                              cancelEditBusField();
                            }
                          }}
                          onBlur={() => cancelEditBusField()}
                          autoFocus
                        >
                          <option value="master">master</option>
                          <option value="slave">slave</option>
                          <option value="monitor">monitor</option>
                        </select>
                      ) : (
                        <span
                          className="text-sm cursor-pointer hover:underline decoration-dotted"
                          style={TEXT_STYLES.muted}
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditBusField(index, "mode", bus.mode);
                          }}
                          title="Click to change mode"
                        >
                          {bus.mode}
                        </span>
                      )}

                      {bus.array && (
                        <span
                          className="text-xs px-1 rounded"
                          style={{
                            background: "var(--vscode-badge-background)",
                            color: "var(--vscode-badge-foreground)",
                          }}
                        >
                          [{bus.array.count}]
                        </span>
                      )}
                    </div>
                    {/* Clock, Reset, Ports info */}
                    <div
                      className="flex items-center gap-4 mt-1 text-sm"
                      style={TEXT_STYLES.muted}
                    >
                      {bus.associatedClock && (
                        <span
                          title={`Port: ${clockInfo?.physicalPort || "N/A"}\nFrequency: ${clockInfo?.frequency || "N/A"}`}
                          style={{ cursor: "help" }}
                        >
                          <span style={TEXT_STYLES.label}>Clock:</span>{" "}
                          <span style={TEXT_STYLES.value}>
                            {bus.associatedClock}
                          </span>
                          {clockInfo?.frequency && (
                            <span style={TEXT_STYLES.muted}>
                              {" "}
                              ({clockInfo.frequency})
                            </span>
                          )}
                        </span>
                      )}
                      {bus.associatedReset && (
                        <span
                          title={`Port: ${resetInfo?.physicalPort || "N/A"}\nPolarity: ${resetInfo?.polarity || "N/A"}`}
                          style={{ cursor: "help" }}
                        >
                          <span style={TEXT_STYLES.label}>Reset:</span>{" "}
                          <span style={TEXT_STYLES.value}>
                            {bus.associatedReset}
                          </span>
                          {resetInfo?.polarity && (
                            <span style={TEXT_STYLES.muted}>
                              {" "}
                              ({resetInfo.polarity})
                            </span>
                          )}
                        </span>
                      )}
                      <span>{ports.length} ports</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeBusInterface(index);
                    }}
                    className="p-1 rounded opacity-60 hover:opacity-100 hover:bg-vscode-toolbar-hoverBackground transition-opacity"
                    title="Delete Bus Interface"
                    style={{ color: "var(--vscode-list-errorForeground)" }}
                  >
                    <span className="codicon codicon-trash"></span>
                  </button>
                </div>

                {/* Expanded content */}
                {expanded && (
                  <div
                    style={{
                      borderTop: "1px solid var(--vscode-panel-border)",
                    }}
                  >
                    {/* Prefix editor */}
                    <div
                      className="px-4 py-2 flex items-center gap-3 text-sm"
                      style={{ background: "var(--vscode-editor-background)" }}
                    >
                      <span style={{ ...TEXT_STYLES.label, minWidth: "50px" }}>
                        Prefix:
                      </span>
                      {editingPrefix === index ? (
                        <div className="flex items-center gap-2 flex-1">
                          <input
                            type="text"
                            value={draftPrefix}
                            onChange={(e) => setDraftPrefix(e.target.value)}
                            className="px-2 py-1 rounded flex-1"
                            style={{
                              ...TEXT_STYLES.value,
                              background: "var(--vscode-input-background)",
                              border: "1px solid var(--vscode-input-border)",
                              color: "var(--vscode-input-foreground)",
                              outline: "none",
                            }}
                            placeholder="e.g., s_axi_"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                savePrefix(index);
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEditPrefix();
                              }
                            }}
                          />
                          <button
                            onClick={() => savePrefix(index)}
                            className="px-2 py-1 rounded text-sm"
                            style={{
                              background: "var(--vscode-button-background)",
                              color: "var(--vscode-button-foreground)",
                            }}
                          >
                            Save
                          </button>
                          <button
                            onClick={cancelEditPrefix}
                            className="px-2 py-1 rounded text-sm"
                            style={{
                              background:
                                "var(--vscode-button-secondaryBackground)",
                              color: "var(--vscode-button-secondaryForeground)",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-1">
                          <span style={TEXT_STYLES.value}>
                            {bus.physicalPrefix || (
                              <span style={TEXT_STYLES.muted}>not set</span>
                            )}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startEditPrefix(index, bus.physicalPrefix || "");
                            }}
                            className="p-1 rounded"
                            title="Edit prefix"
                          >
                            <span
                              className="codicon codicon-edit"
                              style={{ fontSize: "12px" }}
                            ></span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Associated Clock & Reset */}
                    <div
                      className="px-4 py-2 text-sm grid grid-cols-2 gap-4"
                      style={{
                        background: "var(--vscode-editor-background)",
                        borderTop: "1px solid var(--vscode-panel-border)",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          style={{ ...TEXT_STYLES.label, minWidth: "60px" }}
                        >
                          Clock:
                        </span>
                        <select
                          value={bus.associatedClock || ""}
                          onChange={(e) =>
                            updateAssociation(
                              index,
                              "associatedClock",
                              e.target.value,
                            )
                          }
                          className="px-2 py-1 rounded flex-1"
                          style={{
                            background: "var(--vscode-input-background)",
                            border:
                              highlight?.entityName === bus.name &&
                              highlight?.field === "associatedClock"
                                ? "1px solid var(--vscode-inputValidation-errorBorder)"
                                : "1px solid var(--vscode-input-border)",
                            color: "var(--vscode-input-foreground)",
                            outline: "none",
                            fontSize: "inherit",
                            boxShadow:
                              highlight?.entityName === bus.name &&
                              highlight?.field === "associatedClock"
                                ? "0 0 0 1px var(--vscode-inputValidation-errorBorder)"
                                : "none",
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="">None</option>
                          {clocks.map((c) => (
                            <option key={c.name} value={c.name}>
                              {c.name}
                              {c.frequency ? ` (${c.frequency})` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          style={{ ...TEXT_STYLES.label, minWidth: "60px" }}
                        >
                          Reset:
                        </span>
                        <select
                          value={bus.associatedReset || ""}
                          onChange={(e) =>
                            updateAssociation(
                              index,
                              "associatedReset",
                              e.target.value,
                            )
                          }
                          className="px-2 py-1 rounded flex-1"
                          style={{
                            background: "var(--vscode-input-background)",
                            border:
                              highlight?.entityName === bus.name &&
                              highlight?.field === "associatedReset"
                                ? "1px solid var(--vscode-inputValidation-errorBorder)"
                                : "1px solid var(--vscode-input-border)",
                            color: "var(--vscode-input-foreground)",
                            outline: "none",
                            fontSize: "inherit",
                            boxShadow:
                              highlight?.entityName === bus.name &&
                              highlight?.field === "associatedReset"
                                ? "0 0 0 1px var(--vscode-inputValidation-errorBorder)"
                                : "none",
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <option value="">None</option>
                          {resets.map((r) => (
                            <option key={r.name} value={r.name}>
                              {r.name}
                              {r.polarity ? ` (${r.polarity})` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Optional Ports */}
                    {(() => {
                      const optionalPorts = getOptionalPorts(bus);
                      if (optionalPorts.length === 0) {
                        return null;
                      }
                      const enabledPorts = bus.useOptionalPorts || [];
                      return (
                        <div
                          className="px-4 py-2 text-sm"
                          style={{
                            background: "var(--vscode-editor-background)",
                            borderTop: "1px solid var(--vscode-panel-border)",
                          }}
                        >
                          <div
                            className="font-medium mb-2"
                            style={TEXT_STYLES.label}
                          >
                            Optional Ports
                          </div>
                          <div className="flex flex-wrap gap-3">
                            {optionalPorts.map((port) => {
                              const isEnabled = enabledPorts.includes(
                                port.name,
                              );
                              return (
                                <label
                                  key={port.name}
                                  className="flex items-center gap-1.5 cursor-pointer"
                                  title={`Width: ${port.width || 1}, Dir: ${port.direction || "N/A"}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isEnabled}
                                    onChange={() =>
                                      toggleOptionalPort(
                                        index,
                                        port.name,
                                        isEnabled,
                                      )
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                      accentColor: "var(--vscode-focusBorder)",
                                    }}
                                  />
                                  <span
                                    style={{
                                      ...TEXT_STYLES.value,
                                      color: isEnabled
                                        ? undefined
                                        : "var(--vscode-input-placeholderForeground)",
                                    }}
                                  >
                                    {port.name}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Memory Map */}
                    <div
                      className="px-4 py-2 text-sm"
                      style={{
                        background: "var(--vscode-editor-background)",
                        borderTop: "1px solid var(--vscode-panel-border)",
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span style={TEXT_STYLES.label}>Memory Map:</span>
                        <div className="flex-1">
                          {(() => {
                            const availableMaps = imports?.memoryMaps || [];
                            // Also check if current value is a file path (legacy/direct)
                            const isFilePath =
                              bus.memoryMapRef &&
                              (bus.memoryMapRef.endsWith(".yml") ||
                                bus.memoryMapRef.endsWith(".yaml"));

                            return (
                              <div className="flex items-center gap-2">
                                <select
                                  value={bus.memoryMapRef || ""}
                                  onChange={(e) =>
                                    onUpdate(
                                      ["busInterfaces", index, "memoryMapRef"],
                                      e.target.value || undefined,
                                    )
                                  }
                                  className="flex-1 px-1 py-0.5 rounded"
                                  style={{
                                    ...TEXT_STYLES.value,
                                    background:
                                      "var(--vscode-input-background)",
                                    border:
                                      "1px solid var(--vscode-input-border)",
                                    color: "var(--vscode-input-foreground)",
                                    outline: "none",
                                    fontSize: "inherit",
                                    boxShadow:
                                      highlight?.entityName === bus.name &&
                                      highlight?.field === "memoryMapRef"
                                        ? "0 0 0 1px var(--vscode-inputValidation-errorBorder)"
                                        : "none",
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <option value="">None</option>

                                  {/* Available Logical Maps */}
                                  {availableMaps.length > 0 && (
                                    <optgroup label="Detected Maps">
                                      {availableMaps.map(
                                        (map: any, i: number) => (
                                          <option
                                            key={map.name || i}
                                            value={map.name}
                                          >
                                            {map.name}
                                          </option>
                                        ),
                                      )}
                                    </optgroup>
                                  )}

                                  {/* Preserve existing value if it's not in the list (e.g. file path or unknown ref) */}
                                  {bus.memoryMapRef &&
                                    !availableMaps.find(
                                      (m: any) => m.name === bus.memoryMapRef,
                                    ) && (
                                      <option value={bus.memoryMapRef}>
                                        {bus.memoryMapRef}{" "}
                                        {isFilePath
                                          ? "(File Path - Deprecated)"
                                          : "(Unknown)"}
                                      </option>
                                    )}
                                </select>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>

                    {/* Array Configuration */}
                    <div
                      className="px-4 py-2 text-sm"
                      style={{
                        background: "var(--vscode-editor-background)",
                        borderTop: "1px solid var(--vscode-panel-border)",
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium" style={TEXT_STYLES.label}>
                          Array Configuration
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleArray(index, !!bus.array);
                          }}
                          className="px-2 py-0.5 rounded text-xs"
                          style={{
                            background:
                              "var(--vscode-button-secondaryBackground)",
                            color: "var(--vscode-button-secondaryForeground)",
                          }}
                        >
                          {bus.array ? "Remove Array" : "Add Array"}
                        </button>
                      </div>
                      {bus.array && (
                        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                          {/* Count */}
                          <div className="flex items-center gap-2">
                            <span style={TEXT_STYLES.label}>Count:</span>
                            {editingArrayField?.busIndex === index &&
                            editingArrayField?.field === "count" ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  value={draftArrayValue}
                                  onChange={(e) =>
                                    setDraftArrayValue(e.target.value)
                                  }
                                  className="px-1 py-0.5 rounded"
                                  style={{
                                    ...TEXT_STYLES.value,
                                    background:
                                      "var(--vscode-input-background)",
                                    border:
                                      "1px solid var(--vscode-input-border)",
                                    color: "var(--vscode-input-foreground)",
                                    outline: "none",
                                    fontSize: "inherit",
                                    width: "50px",
                                  }}
                                  autoFocus
                                  min="1"
                                  onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      saveArrayField(index);
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      cancelEditArrayField();
                                    }
                                  }}
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    saveArrayField(index);
                                  }}
                                  className="px-1 py-0.5 rounded text-xs"
                                  style={{
                                    background:
                                      "var(--vscode-button-background)",
                                    color: "var(--vscode-button-foreground)",
                                  }}
                                >
                                  ✓
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    cancelEditArrayField();
                                  }}
                                  className="px-1 py-0.5 rounded text-xs"
                                  style={{
                                    background:
                                      "var(--vscode-button-secondaryBackground)",
                                    color:
                                      "var(--vscode-button-secondaryForeground)",
                                  }}
                                >
                                  ✗
                                </button>
                              </div>
                            ) : (
                              <span
                                onClick={() =>
                                  startEditArrayField(
                                    index,
                                    "count",
                                    bus.array!.count,
                                  )
                                }
                                className="cursor-pointer"
                                style={{
                                  ...TEXT_STYLES.value,
                                  textDecoration: "underline",
                                  textDecorationStyle: "dotted",
                                }}
                                title="Click to edit"
                              >
                                {bus.array.count}
                              </span>
                            )}
                          </div>
                          {/* Index Start */}
                          <div className="flex items-center gap-2">
                            <span style={TEXT_STYLES.label}>Index Start:</span>
                            {editingArrayField?.busIndex === index &&
                            editingArrayField?.field === "indexStart" ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="number"
                                  value={draftArrayValue}
                                  onChange={(e) =>
                                    setDraftArrayValue(e.target.value)
                                  }
                                  className="px-1 py-0.5 rounded"
                                  style={{
                                    ...TEXT_STYLES.value,
                                    background:
                                      "var(--vscode-input-background)",
                                    border:
                                      "1px solid var(--vscode-input-border)",
                                    color: "var(--vscode-input-foreground)",
                                    outline: "none",
                                    fontSize: "inherit",
                                    width: "50px",
                                  }}
                                  autoFocus
                                  min="0"
                                  onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      saveArrayField(index);
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      cancelEditArrayField();
                                    }
                                  }}
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    saveArrayField(index);
                                  }}
                                  className="px-1 py-0.5 rounded text-xs"
                                  style={{
                                    background:
                                      "var(--vscode-button-background)",
                                    color: "var(--vscode-button-foreground)",
                                  }}
                                >
                                  ✓
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    cancelEditArrayField();
                                  }}
                                  className="px-1 py-0.5 rounded text-xs"
                                  style={{
                                    background:
                                      "var(--vscode-button-secondaryBackground)",
                                    color: "var(--vscode-button-foreground)",
                                  }}
                                >
                                  ✗
                                </button>
                              </div>
                            ) : (
                              <span
                                onClick={() =>
                                  startEditArrayField(
                                    index,
                                    "indexStart",
                                    bus.array!.indexStart ?? 0,
                                  )
                                }
                                className="cursor-pointer"
                                style={{
                                  ...TEXT_STYLES.value,
                                  textDecoration: "underline",
                                  textDecorationStyle: "dotted",
                                }}
                                title="Click to edit"
                              >
                                {bus.array.indexStart ?? 0}
                              </span>
                            )}
                          </div>
                          {/* Naming Pattern */}
                          <div className="col-span-2 flex items-center gap-2">
                            <span style={TEXT_STYLES.label}>
                              Naming Pattern:
                            </span>
                            {editingArrayField?.busIndex === index &&
                            editingArrayField?.field === "namingPattern" ? (
                              <div className="flex items-center gap-1 flex-1">
                                <input
                                  type="text"
                                  value={draftArrayValue}
                                  onChange={(e) =>
                                    setDraftArrayValue(e.target.value)
                                  }
                                  className="px-1 py-0.5 rounded flex-1"
                                  style={{
                                    ...TEXT_STYLES.value,
                                    background:
                                      "var(--vscode-input-background)",
                                    border:
                                      "1px solid var(--vscode-input-border)",
                                    color: "var(--vscode-input-foreground)",
                                    outline: "none",
                                    fontSize: "inherit",
                                  }}
                                  autoFocus
                                  placeholder="e.g., NAME_{index}"
                                  onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      saveArrayField(index);
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      cancelEditArrayField();
                                    }
                                  }}
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    saveArrayField(index);
                                  }}
                                  className="px-1 py-0.5 rounded text-xs"
                                  style={{
                                    background:
                                      "var(--vscode-button-background)",
                                    color: "var(--vscode-button-foreground)",
                                  }}
                                >
                                  ✓
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    cancelEditArrayField();
                                  }}
                                  className="px-1 py-0.5 rounded text-xs"
                                  style={{
                                    background:
                                      "var(--vscode-button-secondaryBackground)",
                                    color: "var(--vscode-button-foreground)",
                                  }}
                                >
                                  ✗
                                </button>
                              </div>
                            ) : (
                              <span
                                onClick={() =>
                                  startEditArrayField(
                                    index,
                                    "namingPattern",
                                    bus.array!.namingPattern || "",
                                  )
                                }
                                className="cursor-pointer"
                                style={{
                                  ...TEXT_STYLES.value,
                                  textDecoration: "underline",
                                  textDecorationStyle: "dotted",
                                  color: bus.array.namingPattern
                                    ? undefined
                                    : "var(--vscode-input-placeholderForeground)",
                                }}
                                title="Click to edit"
                              >
                                {bus.array.namingPattern || "not set"}
                              </span>
                            )}
                          </div>
                          {/* Physical Prefix Pattern */}
                          <div className="col-span-2 flex items-center gap-2">
                            <span style={TEXT_STYLES.label}>
                              Prefix Pattern:
                            </span>
                            {editingArrayField?.busIndex === index &&
                            editingArrayField?.field ===
                              "physicalPrefixPattern" ? (
                              <div className="flex items-center gap-1 flex-1">
                                <input
                                  type="text"
                                  value={draftArrayValue}
                                  onChange={(e) =>
                                    setDraftArrayValue(e.target.value)
                                  }
                                  className="px-1 py-0.5 rounded flex-1"
                                  style={{
                                    ...TEXT_STYLES.value,
                                    background:
                                      "var(--vscode-input-background)",
                                    border:
                                      "1px solid var(--vscode-input-border)",
                                    color: "var(--vscode-input-foreground)",
                                    outline: "none",
                                    fontSize: "inherit",
                                  }}
                                  autoFocus
                                  placeholder="e.g., prefix_{index}_"
                                  onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      saveArrayField(index);
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      cancelEditArrayField();
                                    }
                                  }}
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    saveArrayField(index);
                                  }}
                                  className="px-1 py-0.5 rounded text-xs"
                                  style={{
                                    background:
                                      "var(--vscode-button-background)",
                                    color: "var(--vscode-button-foreground)",
                                  }}
                                >
                                  ✓
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    cancelEditArrayField();
                                  }}
                                  className="px-1 py-0.5 rounded text-xs"
                                  style={{
                                    background:
                                      "var(--vscode-button-secondaryBackground)",
                                    color: "var(--vscode-button-foreground)",
                                  }}
                                >
                                  ✗
                                </button>
                              </div>
                            ) : (
                              <span
                                onClick={() =>
                                  startEditArrayField(
                                    index,
                                    "physicalPrefixPattern",
                                    bus.array!.physicalPrefixPattern || "",
                                  )
                                }
                                className="cursor-pointer"
                                style={{
                                  ...TEXT_STYLES.value,
                                  textDecoration: "underline",
                                  textDecorationStyle: "dotted",
                                  color: bus.array.physicalPrefixPattern
                                    ? undefined
                                    : "var(--vscode-input-placeholderForeground)",
                                }}
                                title="Click to edit"
                              >
                                {bus.array.physicalPrefixPattern || "not set"}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Ports table */}
                    {ports.length > 0 ? (
                      <table
                        className="w-full text-sm"
                        style={{
                          borderTop: "1px solid var(--vscode-panel-border)",
                        }}
                      >
                        <thead>
                          <tr
                            style={{
                              background: "var(--vscode-editor-background)",
                            }}
                          >
                            <th
                              className="px-4 py-2 text-left font-medium"
                              style={TEXT_STYLES.label}
                            >
                              Logical Name
                            </th>
                            <th
                              className="px-4 py-2 text-left font-medium"
                              style={TEXT_STYLES.label}
                            >
                              Physical Name
                            </th>
                            <th
                              className="px-4 py-2 text-left font-medium"
                              style={TEXT_STYLES.label}
                            >
                              Width
                            </th>
                            <th
                              className="px-4 py-2 text-left font-medium"
                              style={TEXT_STYLES.label}
                            >
                              Dir
                            </th>
                            <th
                              className="px-4 py-2 text-left font-medium"
                              style={TEXT_STYLES.label}
                            >
                              Presence
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {ports.map((port, pIdx) => {
                            const portSuffix = getPortSuffix(bus, port.name);
                            const physicalName = getPhysicalName(
                              bus,
                              port.name,
                            );
                            const isEditingThisPortName =
                              editingPortName?.busIndex === index &&
                              editingPortName?.portName === port.name;
                            const isEditingThisPortWidth =
                              editingPortWidth?.busIndex === index &&
                              editingPortWidth?.portName === port.name;
                            const hasNameOverride =
                              bus.portNameOverrides?.[port.name];
                            const hasWidthOverride =
                              bus.portWidthOverrides?.[port.name];
                            const isSelectedRow =
                              isSelected && selectedPortIndex === pIdx;
                            const defaultWidth =
                              busLibrary?.[bus.type]?.ports?.find(
                                (p) => p.name === port.name,
                              )?.width || 1;

                            return (
                              <tr
                                key={pIdx}
                                data-port-index={pIdx}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedIndex(index);
                                  setSelectedPortIndex(pIdx);
                                  containerRef.current?.focus();
                                }}
                                style={{
                                  borderTop:
                                    "1px solid var(--vscode-panel-border)",
                                  background: isSelectedRow
                                    ? "var(--vscode-list-activeSelectionBackground)"
                                    : pIdx % 2 === 0
                                      ? "transparent"
                                      : "var(--vscode-editor-background)",
                                }}
                              >
                                <td
                                  className="px-4 py-1.5"
                                  style={TEXT_STYLES.value}
                                >
                                  {port.name}
                                </td>
                                <td
                                  className="px-4 py-1.5"
                                  style={{
                                    outline:
                                      isSelectedRow &&
                                      selectedColumn === "name" &&
                                      !isEditingThisPortName
                                        ? "1px solid var(--vscode-focusBorder)"
                                        : undefined,
                                    outlineOffset: "-1px",
                                  }}
                                >
                                  {isEditingThisPortName ? (
                                    <div className="flex items-center gap-1">
                                      <span
                                        style={{
                                          ...TEXT_STYLES.value,
                                          ...TEXT_STYLES.muted,
                                        }}
                                      >
                                        {bus.physicalPrefix || ""}
                                      </span>
                                      <input
                                        type="text"
                                        value={draftPortName}
                                        onChange={(e) =>
                                          setDraftPortName(e.target.value)
                                        }
                                        className="px-1 py-0.5 rounded"
                                        style={{
                                          ...TEXT_STYLES.value,
                                          background:
                                            "var(--vscode-input-background)",
                                          border:
                                            "1px solid var(--vscode-input-border)",
                                          color:
                                            "var(--vscode-input-foreground)",
                                          outline: "none",
                                          fontSize: "inherit",
                                          minWidth: "80px",
                                        }}
                                        autoFocus
                                        onKeyDown={(e) => {
                                          e.stopPropagation();
                                          if (e.key === "Enter") {
                                            e.preventDefault();
                                            savePortName(index, port.name);
                                          } else if (e.key === "Escape") {
                                            e.preventDefault();
                                            cancelEditPortName();
                                          }
                                        }}
                                      />
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          savePortName(index, port.name);
                                        }}
                                        className="px-1.5 py-0.5 rounded text-xs"
                                        style={{
                                          background:
                                            "var(--vscode-button-background)",
                                          color:
                                            "var(--vscode-button-foreground)",
                                        }}
                                      >
                                        ✓
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          cancelEditPortName();
                                        }}
                                        className="px-1.5 py-0.5 rounded text-xs"
                                        style={{
                                          background:
                                            "var(--vscode-button-secondaryBackground)",
                                          color:
                                            "var(--vscode-button-foreground)",
                                        }}
                                      >
                                        ✗
                                      </button>
                                    </div>
                                  ) : (
                                    <span
                                      onClick={() =>
                                        startEditPortName(
                                          index,
                                          port.name,
                                          portSuffix,
                                        )
                                      }
                                      className="cursor-pointer"
                                      title="Click to edit suffix (or press e)"
                                    >
                                      <span style={TEXT_STYLES.muted}>
                                        {bus.physicalPrefix || ""}
                                      </span>
                                      <span
                                        style={{
                                          ...TEXT_STYLES.value,
                                          color: hasNameOverride
                                            ? "var(--vscode-textLink-foreground)"
                                            : undefined,
                                          textDecoration: "underline",
                                          textDecorationStyle: "dotted",
                                        }}
                                      >
                                        {portSuffix}
                                      </span>
                                    </span>
                                  )}
                                </td>
                                <td
                                  className="px-4 py-1.5"
                                  style={{
                                    outline:
                                      isSelectedRow &&
                                      selectedColumn === "width" &&
                                      !isEditingThisPortWidth
                                        ? "1px solid var(--vscode-focusBorder)"
                                        : undefined,
                                    outlineOffset: "-1px",
                                  }}
                                >
                                  {isEditingThisPortWidth ? (
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="number"
                                        value={draftPortWidth}
                                        onChange={(e) =>
                                          setDraftPortWidth(e.target.value)
                                        }
                                        className="px-1 py-0.5 rounded"
                                        style={{
                                          ...TEXT_STYLES.value,
                                          background:
                                            "var(--vscode-input-background)",
                                          border:
                                            "1px solid var(--vscode-input-border)",
                                          color:
                                            "var(--vscode-input-foreground)",
                                          outline: "none",
                                          fontSize: "inherit",
                                          width: "60px",
                                        }}
                                        autoFocus
                                        onKeyDown={(e) => {
                                          e.stopPropagation();
                                          if (e.key === "Enter") {
                                            e.preventDefault();
                                            savePortWidth(
                                              index,
                                              port.name,
                                              defaultWidth,
                                            );
                                          } else if (e.key === "Escape") {
                                            e.preventDefault();
                                            cancelEditPortWidth();
                                          }
                                        }}
                                      />
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          savePortWidth(
                                            index,
                                            port.name,
                                            defaultWidth,
                                          );
                                        }}
                                        className="px-1.5 py-0.5 rounded text-xs"
                                        style={{
                                          background:
                                            "var(--vscode-button-background)",
                                          color:
                                            "var(--vscode-button-foreground)",
                                        }}
                                      >
                                        ✓
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          cancelEditPortWidth();
                                        }}
                                        className="px-1.5 py-0.5 rounded text-xs"
                                        style={{
                                          background:
                                            "var(--vscode-button-secondaryBackground)",
                                          color:
                                            "var(--vscode-button-foreground)",
                                        }}
                                      >
                                        ✗
                                      </button>
                                    </div>
                                  ) : (
                                    <span
                                      onClick={() =>
                                        startEditPortWidth(
                                          index,
                                          port.name,
                                          port.width || 1,
                                        )
                                      }
                                      className="cursor-pointer"
                                      style={{
                                        color: hasWidthOverride
                                          ? "var(--vscode-textLink-foreground)"
                                          : undefined,
                                        textDecoration: "underline",
                                        textDecorationStyle: "dotted",
                                      }}
                                      title="Click to edit width (or press e)"
                                    >
                                      {port.width || 1}
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-1.5">
                                  <span
                                    style={{
                                      color:
                                        port.direction === "in"
                                          ? "var(--vscode-charts-green)"
                                          : port.direction === "out"
                                            ? "var(--vscode-charts-blue)"
                                            : undefined,
                                    }}
                                  >
                                    {port.direction || "—"}
                                  </span>
                                </td>
                                <td
                                  className="px-4 py-1.5"
                                  style={TEXT_STYLES.muted}
                                >
                                  {port.presence}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    ) : (
                      <div
                        className="px-4 py-4 text-sm"
                        style={{
                          ...TEXT_STYLES.muted,
                          borderTop: "1px solid var(--vscode-panel-border)",
                        }}
                      >
                        {busLibrary
                          ? "No ports defined for this interface type."
                          : "Bus library not loaded."}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
