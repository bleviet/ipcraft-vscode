import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { YamlUpdateHandler } from '../../../types/editor';
import { focusContainer } from '../../../shared/utils/focus';
import { BusInterfaceCard } from './BusInterfaceCard';
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
  busInterfaces: unknown[];
  busLibrary?: unknown;
  clocks?: unknown[];
  resets?: unknown[];
  onUpdate: YamlUpdateHandler;
  highlight?: { entityName: string; field: string };
  imports?: { memoryMaps?: unknown[] };
}

// Consistent text styles
const TEXT_STYLES = {
  label: { opacity: 0.6 },
  value: { fontFamily: 'var(--vscode-editor-font-family, monospace)' },
  muted: { opacity: 0.7 },
};

/**
 * Get effective ports for a bus interface based on library definition and overrides
 */
function getEffectivePorts(
  bus: BusInterface,
  busLibrary: Record<string, { ports?: BusPort[] }> | undefined
): BusPort[] {
  if (!busLibrary || !bus.type || !busLibrary[bus.type]) {
    return [];
  }

  const libraryDef = busLibrary[bus.type];
  const libraryPorts = libraryDef.ports ?? [];
  const optionalPorts = bus.useOptionalPorts ?? [];
  const widthOverrides = bus.portWidthOverrides ?? {};

  return libraryPorts
    .filter((port) => {
      if (port.presence === 'required') {
        return true;
      }
      if (port.presence === 'optional' && optionalPorts.includes(port.name)) {
        return true;
      }
      return false;
    })
    .map((port) => ({
      ...port,
      width: widthOverrides[port.name] ?? port.width,
      direction:
        bus.mode === 'slave' && port.direction
          ? port.direction === 'in'
            ? 'out'
            : port.direction === 'out'
              ? 'in'
              : port.direction
          : port.direction,
    }));
}

/**
 * Bus Interfaces Editor - Clean consistent styling
 */
export const BusInterfacesEditor: React.FC<BusInterfacesEditorProps> = ({
  busInterfaces: rawBusInterfaces,
  busLibrary: rawBusLibrary,
  imports,
  clocks: rawClocks = [],
  resets: rawResets = [],
  onUpdate,
  highlight,
}) => {
  const busInterfaces = rawBusInterfaces as BusInterface[];
  const busLibrary = rawBusLibrary as Record<string, { ports?: BusPort[] }> | undefined;
  const clocks = rawClocks as Clock[];
  const resets = rawResets as Reset[];
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [expandedIndexes, setExpandedIndexes] = useState<Set<number>>(new Set());
  const [expandAll, setExpandAll] = useState(false);
  const [editingPrefix, setEditingPrefix] = useState<number | null>(null);
  const [draftPrefix, setDraftPrefix] = useState('');
  const [editingPortName, setEditingPortName] = useState<{
    busIndex: number;
    portName: string;
  } | null>(null);
  const [draftPortName, setDraftPortName] = useState('');
  // Port-level navigation state
  const [selectedPortIndex, setSelectedPortIndex] = useState(0);
  const [selectedColumn, setSelectedColumn] = useState<'name' | 'width'>('name');
  const [editingPortWidth, setEditingPortWidth] = useState<{
    busIndex: number;
    portName: string;
  } | null>(null);
  const [draftPortWidth, setDraftPortWidth] = useState('');
  // Array field editing
  const [editingArrayField, setEditingArrayField] = useState<{
    busIndex: number;
    field: 'count' | 'indexStart' | 'namingPattern' | 'physicalPrefixPattern';
  } | null>(null);
  const [draftArrayValue, setDraftArrayValue] = useState('');
  // Bus field editing
  const [editingBusField, setEditingBusField] = useState<{
    busIndex: number;
    field: 'name' | 'type' | 'mode';
  } | null>(null);
  const [draftBusValue, setDraftBusValue] = useState('');
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

  const startEditPrefix = useCallback((index: number, currentPrefix: string) => {
    setEditingPrefix(index);
    setDraftPrefix(currentPrefix || '');
  }, []);

  const savePrefix = useCallback(
    (index: number) => {
      onUpdate(['busInterfaces', index, 'physicalPrefix'], draftPrefix);
      setEditingPrefix(null);
      setDraftPrefix('');
      focusContainer(containerRef);
    },
    [draftPrefix, onUpdate]
  );

  const cancelEditPrefix = useCallback(() => {
    setEditingPrefix(null);
    setDraftPrefix('');
    focusContainer(containerRef);
  }, []);

  // Port name editing - only edit the suffix, not the prefix
  const getPortSuffix = (bus: BusInterface, portName: string): string => {
    if (bus.portNameOverrides?.[portName]) {
      return bus.portNameOverrides[portName];
    }
    return portName.toLowerCase();
  };

  const startEditPortName = useCallback(
    (busIndex: number, portName: string, currentSuffix: string) => {
      setEditingPortName({ busIndex, portName });
      setDraftPortName(currentSuffix);
    },
    []
  );

  const savePortName = useCallback(
    (busIndex: number, portName: string) => {
      const defaultSuffix = portName.toLowerCase();
      const bus = busInterfaces[busIndex];
      const newOverrides = { ...(bus.portNameOverrides ?? {}) };

      if (draftPortName === defaultSuffix || draftPortName === '') {
        delete newOverrides[portName];
      } else {
        newOverrides[portName] = draftPortName;
      }

      onUpdate(
        ['busInterfaces', busIndex, 'portNameOverrides'],
        Object.keys(newOverrides).length > 0 ? newOverrides : undefined
      );
      setEditingPortName(null);
      setDraftPortName('');
      focusContainer(containerRef);
    },
    [busInterfaces, draftPortName, onUpdate]
  );

  const cancelEditPortName = useCallback(() => {
    setEditingPortName(null);
    setDraftPortName('');
    focusContainer(containerRef);
  }, []);

  // Width editing
  const startEditPortWidth = useCallback(
    (busIndex: number, portName: string, currentWidth: number) => {
      setEditingPortWidth({ busIndex, portName });
      setDraftPortWidth(String(currentWidth));
    },
    []
  );

  const savePortWidth = useCallback(
    (busIndex: number, portName: string, defaultWidth: number) => {
      const bus = busInterfaces[busIndex];
      const newOverrides = { ...(bus.portWidthOverrides ?? {}) };
      const newWidth = parseInt(draftPortWidth, 10);

      if (isNaN(newWidth) || newWidth === defaultWidth) {
        delete newOverrides[portName];
      } else {
        newOverrides[portName] = newWidth;
      }

      onUpdate(
        ['busInterfaces', busIndex, 'portWidthOverrides'],
        Object.keys(newOverrides).length > 0 ? newOverrides : undefined
      );
      setEditingPortWidth(null);
      setDraftPortWidth('');
      focusContainer(containerRef);
    },
    [busInterfaces, draftPortWidth, onUpdate]
  );

  const cancelEditPortWidth = useCallback(() => {
    setEditingPortWidth(null);
    setDraftPortWidth('');
    focusContainer(containerRef);
  }, []);

  // Array field editing
  type ArrayField = 'count' | 'indexStart' | 'namingPattern' | 'physicalPrefixPattern';

  const startEditArrayField = useCallback(
    (busIndex: number, field: ArrayField, currentValue: string | number) => {
      setEditingArrayField({ busIndex, field });
      setDraftArrayValue(String(currentValue));
    },
    []
  );

  const saveArrayField = useCallback(
    (busIndex: number) => {
      if (!editingArrayField) {
        return;
      }
      const { field } = editingArrayField;

      if (field === 'count' || field === 'indexStart') {
        const numValue = parseInt(draftArrayValue, 10);
        if (!isNaN(numValue) && (field === 'indexStart' || numValue > 0)) {
          onUpdate(['busInterfaces', busIndex, 'array', field], numValue);
        }
      } else {
        // String fields: namingPattern, physicalPrefixPattern
        if (draftArrayValue.trim()) {
          onUpdate(['busInterfaces', busIndex, 'array', field], draftArrayValue.trim());
        } else {
          // Remove empty patterns
          onUpdate(['busInterfaces', busIndex, 'array', field], undefined);
        }
      }

      setEditingArrayField(null);
      setDraftArrayValue('');
      focusContainer(containerRef);
    },
    [editingArrayField, draftArrayValue, onUpdate]
  );

  const cancelEditArrayField = useCallback(() => {
    setEditingArrayField(null);
    setDraftArrayValue('');
    focusContainer(containerRef);
  }, []);

  // Toggle array configuration
  const toggleArray = useCallback(
    (busIndex: number, hasArray: boolean) => {
      if (hasArray) {
        // Remove array
        onUpdate(['busInterfaces', busIndex, 'array'], undefined);
      } else {
        // Add array with default values
        onUpdate(['busInterfaces', busIndex, 'array'], {
          count: 2,
          indexStart: 0,
        });
      }
    },
    [onUpdate]
  );

  // Toggle optional port
  const toggleOptionalPort = useCallback(
    (busIndex: number, portName: string, currentlyEnabled: boolean) => {
      const bus = busInterfaces[busIndex];
      const currentOptional = bus.useOptionalPorts ?? [];

      let newOptional: string[];
      if (currentlyEnabled) {
        newOptional = currentOptional.filter((p) => p !== portName);
      } else {
        newOptional = [...currentOptional, portName];
      }

      onUpdate(
        ['busInterfaces', busIndex, 'useOptionalPorts'],
        newOptional.length > 0 ? newOptional : undefined
      );
    },
    [busInterfaces, onUpdate]
  );

  // Update associated clock/reset
  const updateAssociation = useCallback(
    (busIndex: number, field: 'associatedClock' | 'associatedReset', value: string) => {
      onUpdate(['busInterfaces', busIndex, field], value || undefined);
    },
    [onUpdate]
  );

  // Get all optional ports from library
  const getOptionalPorts = useCallback(
    (bus: BusInterface): BusPort[] => {
      if (!busLibrary || !bus.type || !busLibrary[bus.type]) {
        return [];
      }
      const libraryDef = busLibrary[bus.type];
      return (libraryDef.ports ?? []).filter((p) => p.presence === 'optional');
    },
    [busLibrary]
  );

  // Bus interface management
  const addBusInterface = useCallback(() => {
    // Default to AXI4 or the first available type
    const availableTypes = busLibrary ? Object.keys(busLibrary) : [];
    const defaultType = availableTypes.includes('AXI4') ? 'AXI4' : availableTypes[0] || 'AXI4';

    const newBus: BusInterface = {
      name: `NEW_INTERFACE_${busInterfaces.length}`,
      type: defaultType,
      mode: 'slave',
    };

    onUpdate(['busInterfaces'], [...busInterfaces, newBus]);

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
      onUpdate(['busInterfaces'], newInterfaces);

      // Adjust selection if needed
      if (selectedIndex >= newInterfaces.length) {
        setSelectedIndex(Math.max(0, newInterfaces.length - 1));
      }
    },
    [busInterfaces, selectedIndex, onUpdate]
  );

  // Bus field editing
  type BusField = 'name' | 'type' | 'mode';

  const startEditBusField = useCallback(
    (busIndex: number, field: BusField, currentValue: string) => {
      setEditingBusField({ busIndex, field });
      setDraftBusValue(currentValue);
    },
    []
  );

  const saveBusField = useCallback(
    (busIndex: number, overrideValue?: string) => {
      if (!editingBusField) {
        return;
      }
      const { field } = editingBusField;

      const valueToSave = overrideValue ?? draftBusValue;

      if (valueToSave.trim()) {
        onUpdate(['busInterfaces', busIndex, field], valueToSave.trim());
      }

      setEditingBusField(null);
      setDraftBusValue('');
      focusContainer(containerRef);
    },
    [editingBusField, draftBusValue, onUpdate]
  );

  const cancelEditBusField = useCallback(() => {
    setEditingBusField(null);
    setDraftBusValue('');
    focusContainer(containerRef);
  }, []);

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
        if (key === 'j' || e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedPortIndex((prev) => Math.min(prev + 1, ports.length - 1));
        } else if (key === 'k' || e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedPortIndex((prev) => Math.max(prev - 1, 0));
        } else if (key === 'h' || e.key === 'ArrowLeft') {
          e.preventDefault();
          setSelectedColumn('name');
        } else if (key === 'l' || e.key === 'ArrowRight') {
          e.preventDefault();
          setSelectedColumn('width');
        } else if (key === 'e') {
          e.preventDefault();
          const port = ports[selectedPortIndex];
          if (port) {
            if (selectedColumn === 'name') {
              startEditPortName(selectedIndex, port.name, getPortSuffix(currentBus, port.name));
            } else {
              startEditPortWidth(selectedIndex, port.name, port.width ?? 1);
            }
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          toggleExpand(selectedIndex); // Collapse to exit port mode
        } else if (key === 'g') {
          e.preventDefault();
          setSelectedPortIndex(0);
        } else if (e.key === 'G' && e.shiftKey) {
          e.preventDefault();
          setSelectedPortIndex(ports.length - 1);
        }
      } else {
        // Top-level bus interface navigation
        if (key === 'j' || e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, busInterfaces.length - 1));
          setSelectedPortIndex(0); // Reset port selection
        } else if (key === 'k' || e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          setSelectedPortIndex(0); // Reset port selection
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleExpand(selectedIndex);
          setSelectedPortIndex(0); // Reset port selection when expanding
        } else if (key === 'g') {
          e.preventDefault();
          setSelectedIndex(0);
        } else if (e.key === 'G' && e.shiftKey) {
          e.preventDefault();
          setSelectedIndex(busInterfaces.length - 1);
        } else if (key === '0') {
          e.preventDefault();
          toggleExpandAll();
        } else if (key === 'd' && e.ctrlKey) {
          // Delete bus interface with Ctrl+D
          e.preventDefault();
          removeBusInterface(selectedIndex);
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
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
    if (highlight?.entityName) {
      const index = busInterfaces.findIndex((b) => b.name === highlight.entityName);
      if (index !== -1) {
        setSelectedIndex(index);
        setExpandedIndexes((prev) => new Set(prev).add(index));
      }
    }
  }, [highlight, busInterfaces]);

  const isExpanded = (index: number) => expandedIndexes.has(index);

  // Scroll Bus Interface into view
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    requestAnimationFrame(() => {
      const el = container.querySelector(`[data-bus-index="${selectedIndex}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  }, [selectedIndex]);

  // Scroll Port into view
  useEffect(() => {
    if (!expandedIndexes.has(selectedIndex)) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }
    requestAnimationFrame(() => {
      const busEl = container.querySelector(`[data-bus-index="${selectedIndex}"]`);
      const portEl = busEl?.querySelector(`[data-port-index="${selectedPortIndex}"]`);
      portEl?.scrollIntoView({ block: 'nearest' });
    });
  }, [selectedPortIndex, selectedIndex, expandedIndexes]);

  return (
    <div ref={containerRef} className="p-6 space-y-4" tabIndex={0} style={{ outline: 'none' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-medium">Bus Interfaces</h2>
          <p className="text-sm mt-1" style={TEXT_STYLES.muted}>
            {busInterfaces.length} interface(s) ·{' '}
            <span style={{ fontFamily: 'monospace', fontSize: '11px' }}>
              j/k navigate · Space expand · h/l column · e edit · 0 toggle all
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={addBusInterface}
            className="px-3 py-1.5 rounded text-sm flex items-center gap-2"
            style={{
              background: 'var(--vscode-button-background)',
              color: 'var(--vscode-button-foreground)',
            }}
          >
            <span className="codicon codicon-add"></span>
            Add Interface
          </button>
          <button
            onClick={toggleExpandAll}
            className="px-3 py-1.5 rounded text-sm flex items-center gap-2"
            style={{
              background: 'var(--vscode-button-secondaryBackground)',
              color: 'var(--vscode-button-secondaryForeground)',
            }}
          >
            <span className={`codicon codicon-${expandAll ? 'collapse-all' : 'expand-all'}`}></span>
            {expandAll ? 'Collapse All' : 'Expand All'}
          </button>
        </div>
      </div>

      {/* Interface list */}
      {busInterfaces.length === 0 ? (
        <div
          className="p-8 text-center rounded text-sm"
          style={{
            background: 'var(--vscode-editor-background)',
            border: '1px solid var(--vscode-panel-border)',
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
            return (
              <BusInterfaceCard
                key={index}
                index={index}
                bus={bus}
                isSelected={isSelected}
                expanded={expanded}
                ports={ports}
                clocks={clocks}
                resets={resets}
                busLibrary={busLibrary}
                imports={imports}
                highlight={highlight}
                selectedPortIndex={selectedPortIndex}
                selectedColumn={selectedColumn}
                editingPrefix={editingPrefix}
                draftPrefix={draftPrefix}
                editingPortName={editingPortName}
                draftPortName={draftPortName}
                editingPortWidth={editingPortWidth}
                draftPortWidth={draftPortWidth}
                editingArrayField={editingArrayField}
                draftArrayValue={draftArrayValue}
                editingBusField={editingBusField}
                draftBusValue={draftBusValue}
                containerRef={containerRef}
                setSelectedIndex={setSelectedIndex}
                setSelectedPortIndex={setSelectedPortIndex}
                setDraftPrefix={setDraftPrefix}
                setDraftPortName={setDraftPortName}
                setDraftPortWidth={setDraftPortWidth}
                setDraftArrayValue={setDraftArrayValue}
                setDraftBusValue={setDraftBusValue}
                toggleExpand={toggleExpand}
                removeBusInterface={removeBusInterface}
                startEditBusField={startEditBusField}
                saveBusField={saveBusField}
                cancelEditBusField={cancelEditBusField}
                startEditPrefix={startEditPrefix}
                savePrefix={savePrefix}
                cancelEditPrefix={cancelEditPrefix}
                updateAssociation={updateAssociation}
                getOptionalPorts={getOptionalPorts}
                toggleOptionalPort={toggleOptionalPort}
                onUpdate={onUpdate}
                toggleArray={toggleArray}
                startEditArrayField={startEditArrayField}
                saveArrayField={saveArrayField}
                cancelEditArrayField={cancelEditArrayField}
                getPortSuffix={getPortSuffix}
                startEditPortName={startEditPortName}
                savePortName={savePortName}
                cancelEditPortName={cancelEditPortName}
                startEditPortWidth={startEditPortWidth}
                savePortWidth={savePortWidth}
                cancelEditPortWidth={cancelEditPortWidth}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
