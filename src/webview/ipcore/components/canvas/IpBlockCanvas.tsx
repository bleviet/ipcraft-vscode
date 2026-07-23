import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type { IpCore } from '../../../types/ipCore';
import { computeLayout } from './canvasLayout';
import { RemoveZone } from './RemoveZone';
import { useCanvasValidation, type CanvasAnnotations } from '../../hooks/useCanvasValidation';
import { lookupBusDef, lookupBusDefFromLibrary, isConduitType } from '../../data/busDefinitions';
import type { BusPortDef } from '../../data/busDefinitions';
import type { YamlUpdateHandler } from '../../../types/editor';
import type { BatchUpdate } from '../../hooks/useGroupPorts';
import { useGroupPorts } from '../../hooks/useGroupPorts';
import type { SuggestionChip } from '../../hooks/useProtocolSuggestions';
import { useCanvasViewport } from '../../hooks/useCanvasViewport';
import { useCanvasMarqueeSelection } from '../../hooks/useCanvasMarqueeSelection';
import { usePortConnectionDrag } from '../../hooks/usePortConnectionDrag';
import { useCanvasDropTarget } from '../../hooks/useCanvasDropTarget';
import { useCanvasKeyboardCommands } from '../../hooks/useCanvasKeyboardCommands';
import { IpBlockDiagram, type CanvasSearchMatches } from './IpBlockDiagram';
import { CanvasHud } from './CanvasHud';
import { PortMappingOverlay, type PendingPortDrop } from './PortMappingOverlay';
import './canvas.css';

/** Distinct colours for clock domains when multiple clocks are defined */
const CLOCK_DOMAIN_COLORS = [
  '#4ec9b0', // teal
  '#e5a96a', // amber-orange
  '#dcdcaa', // yellow
  '#c586c0', // purple
  '#9cdcfe', // sky blue
  '#f28b82', // coral
];

interface IpBlockCanvasProps {
  ipCore: IpCore;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** ID of the individually selected bus signal (e.g. "bus:0:TLAST"), if any */
  selectedSubPortId?: string | null;
  /** Called when a bus signal is clicked, to mark it as the selected signal */
  onSelectSubPort?: (subPortId: string) => void;
  onUpdate?: YamlUpdateHandler;
  /** Drag-over handler from useCanvasDrop (Phase 3) */
  onDragOver?: (e: React.DragEvent) => void;
  /** Drop handler from useCanvasDrop (Phase 3) */
  onDrop?: (e: React.DragEvent) => void;
  /** Remove handler when a port is dropped to delete (Phase 4) */
  onRemove?: (kind: string, id: string) => void;
  /** Runtime bus library from imports (includes custom bus definitions) */
  busLibrary?: Record<string, unknown>;
  /** IDs currently in the multi-selection set (for dashed ring rendering) */
  multiSelectedIds?: Set<string>;
  /** Shift+Click handler — toggles membership in multi-selection */
  onShiftSelect?: (id: string) => void;
  /** Atomic batch update for grouping operations (single undo entry) */
  batchUpdate?: BatchUpdate;
  /** Protocol suggestion chips from useProtocolSuggestions */
  suggestionChips?: SuggestionChip[];
  /** Called when the multi-selection toolbar is dismissed */
  onDismissSelection?: () => void;
  /** Called when a suggestion chip is dismissed */
  onDismissSuggestion?: (chipId: string) => void;
  /** Consistency-check findings projected onto canvas element ids, merged with validation dots */
  consistencyAnnotations?: CanvasAnnotations;
}

/**
 * Main canvas component rendering the IP core as an SVG schematic block.
 *
 * The block body sits at center with ports arranged along left, right, and bottom edges.
 * Bus interfaces render as wide "bundle" connectors; clocks/resets/ports as thin stubs.
 * Bus bundles can be expanded to show individual port signals.
 *
 * This component owns interaction state (viewport, selection, drag, search) and composes
 * it via hooks; actual SVG/HUD/overlay rendering is delegated to `IpBlockDiagram`,
 * `CanvasHud`, and `PortMappingOverlay`.
 */
export const IpBlockCanvas: React.FC<IpBlockCanvasProps> = ({
  ipCore,
  selectedId,
  onSelect,
  selectedSubPortId = null,
  onSelectSubPort,
  onUpdate,
  onDragOver,
  onDrop,
  onRemove,
  busLibrary,
  multiSelectedIds,
  onShiftSelect,
  batchUpdate,
  suggestionChips,
  onDismissSelection,
  onDismissSuggestion,
  consistencyAnnotations,
}) => {
  // Pending port-drop onto a standard (protocol-defined) bus interface
  const [pendingPortDrop, setPendingPortDrop] = useState<PendingPortDrop | null>(null);
  const [expandedBusIds, setExpandedBusIds] = useState<Set<string>>(new Set());
  const [showHelp, setShowHelp] = useState(false);

  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  const busDefs = useMemo((): ((type: string) => BusPortDef[] | null) => {
    if (!busLibrary) {
      return lookupBusDef;
    }
    return (type: string) => {
      const hardcoded = lookupBusDef(type);
      if (hardcoded !== null) {
        return hardcoded;
      }
      return lookupBusDefFromLibrary(type, busLibrary);
    };
  }, [busLibrary]);

  const layout = useMemo(
    () => computeLayout(ipCore, expandedBusIds, busDefs, ipCore.description ?? undefined),
    [ipCore, expandedBusIds, busDefs]
  );
  const { ports, subPorts } = layout;

  // Assign distinct colours per clock domain when multiple clocks are defined
  const multiDomain = (ipCore.clocks?.length ?? 0) > 1;
  const getDomainColor = useCallback(
    (idx: number): string | undefined => {
      if (!multiDomain || idx < 0) {
        return undefined;
      }
      return CLOCK_DOMAIN_COLORS[idx % CLOCK_DOMAIN_COLORS.length];
    },
    [multiDomain]
  );

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [blockHovered, setBlockHovered] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  const {
    zoom,
    pan,
    isPanning,
    spaceDown,
    spaceDownRef,
    showZoomIndicator,
    hasDraggedRef,
    resetView,
  } = useCanvasViewport(containerRef);

  const { marqueeRect } = useCanvasMarqueeSelection(
    containerRef,
    spaceDownRef,
    hasDraggedRef,
    onShiftSelect
  );

  const {
    dragActive,
    dragOutActive,
    dragHoverSide,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
  } = useCanvasDropTarget({ onDragOver, onDrop, onRemove });

  const validationAnnotations = useCanvasValidation(ipCore);
  const annotations = useMemo<CanvasAnnotations>(() => {
    if (!consistencyAnnotations) {
      return validationAnnotations;
    }
    const merged: CanvasAnnotations = { ...validationAnnotations };
    for (const [id, list] of Object.entries(consistencyAnnotations)) {
      merged[id] = [...(merged[id] ?? []), ...list];
    }
    return merged;
  }, [validationAnnotations, consistencyAnnotations]);

  // Group ports hook — only instantiated when batchUpdate is available
  const noopBatch: BatchUpdate = useCallback(() => {}, []);
  const groupPorts = useGroupPorts(ipCore, batchUpdate ?? noopBatch, busDefs);

  const handlePortDropOnBus = useCallback(
    (portIndex: number, busIndex: number) => {
      if (!batchUpdate) {
        return;
      }
      const bus = ipCore.busInterfaces?.[busIndex];
      if (!bus) {
        return;
      }
      // Mirror isCustomBusInterface logic: conduit mode, conduit type, inline
      // conduitPorts, or any type not in the built-in protocol catalog.
      const isCustom =
        bus.mode === 'conduit' ||
        isConduitType(bus.type) ||
        (bus.conduitPorts?.length ?? 0) > 0 ||
        lookupBusDef(bus.type) === null;

      if (isCustom) {
        // Conduit / custom interface: add immediately, no dialog needed.
        groupPorts.addPortToConduit(portIndex, busIndex);
        // Expand so the user sees the newly added conduit signal.
        const busId = `bus:${busIndex}`;
        setExpandedBusIds((prev) => new Set([...prev, busId]));
      } else {
        // Standard protocol: open GroupingMappingStep to let the user pick assignments.
        setPendingPortDrop({ portIndex, busIndex });
      }
    },
    [batchUpdate, groupPorts, ipCore]
  );

  const { portDragActive, portDragActivePIdx, portDragHoveredBus, handlePortPointerDragStart } =
    usePortConnectionDrag(handlePortDropOnBus);

  const handleBackgroundClick = useCallback(
    (e: React.MouseEvent) => {
      // Shift+click on the background should do nothing — don't disturb multi-selection
      if (e.shiftKey) {
        return;
      }
      // If the mousedown turned into a pan-drag, suppress the deselect
      if (hasDraggedRef.current) {
        hasDraggedRef.current = false;
        return;
      }
      onSelect(null);
      onDismissSelection?.();
    },
    [onSelect, onDismissSelection]
  );

  const handleBackgroundDoubleClick = useCallback(() => {
    resetView();
  }, [resetView]);

  const exitSelectMode = useCallback(() => {
    onSelect(null);
    onDismissSelection?.();
  }, [onSelect, onDismissSelection]);

  const toggleBusExpand = useCallback((busId: string) => {
    setExpandedBusIds((prev) => {
      const next = new Set(prev);
      if (next.has(busId)) {
        next.delete(busId);
      } else {
        next.add(busId);
      }
      return next;
    });
  }, []);

  const handleSubPortActivate = useCallback(
    (subPortId: string) => {
      // subPortId format: "bus:0:AWADDR"
      const parts = subPortId.split(':');
      if (parts.length < 3) {
        return;
      }
      const busIndex = parseInt(parts[1], 10);
      const portName = parts.slice(2).join(':');
      const bus = (ipCore.busInterfaces ?? [])[busIndex] as
        | { useOptionalPorts?: string[] }
        | undefined;
      const current = bus?.useOptionalPorts ?? [];
      if (!current.includes(portName)) {
        onUpdate?.(['busInterfaces', busIndex, 'useOptionalPorts'], [...current, portName]);
      }
    },
    [ipCore, onUpdate]
  );

  const handleSubPortDeactivate = useCallback(
    (subPortId: string) => {
      const parts = subPortId.split(':');
      if (parts.length < 3) {
        return;
      }
      const busIndex = parseInt(parts[1], 10);
      const portName = parts.slice(2).join(':');
      const bus = (ipCore.busInterfaces ?? [])[busIndex] as
        | { useOptionalPorts?: string[] }
        | undefined;
      const current = bus?.useOptionalPorts ?? [];
      const updated = current.filter((p) => p !== portName);
      onUpdate?.(
        ['busInterfaces', busIndex, 'useOptionalPorts'],
        updated.length > 0 ? updated : undefined
      );
    },
    [ipCore, onUpdate]
  );

  const KIND_TO_ARRAY: Record<string, string> = {
    port: 'ports',
    clock: 'clocks',
    reset: 'resets',
    interrupt: 'interrupts',
    bus: 'busInterfaces',
  };

  const handleElementRename = useCallback(
    (id: string, newName: string) => {
      const colonIdx = id.indexOf(':');
      if (colonIdx < 0) {
        return;
      }
      const kind = id.slice(0, colonIdx);
      const index = parseInt(id.slice(colonIdx + 1), 10);
      const arrayName = KIND_TO_ARRAY[kind];
      if (!arrayName || isNaN(index)) {
        return;
      }
      const trimmed = newName.trim();
      if (!trimmed) {
        return;
      }

      type Named = { name?: string };
      type WithAssocClock = { associatedClock?: string | null };
      type WithAssocReset = { associatedReset?: string | null };

      if (kind === 'clock') {
        const oldName = ((ipCore.clocks ?? []) as Named[])[index]?.name;
        onUpdate?.([arrayName, index, 'name'], trimmed);
        if (oldName) {
          ((ipCore.resets ?? []) as WithAssocClock[]).forEach((r, i) => {
            if (r.associatedClock === oldName) {
              onUpdate?.(['resets', i, 'associatedClock'], trimmed);
            }
          });
          ((ipCore.busInterfaces ?? []) as WithAssocClock[]).forEach((b, i) => {
            if (b.associatedClock === oldName) {
              onUpdate?.(['busInterfaces', i, 'associatedClock'], trimmed);
            }
          });
        }
      } else if (kind === 'reset') {
        const oldName = ((ipCore.resets ?? []) as Named[])[index]?.name;
        onUpdate?.([arrayName, index, 'name'], trimmed);
        if (oldName) {
          ((ipCore.clocks ?? []) as WithAssocReset[]).forEach((c, i) => {
            if (c.associatedReset === oldName) {
              onUpdate?.(['clocks', i, 'associatedReset'], trimmed);
            }
          });
          ((ipCore.busInterfaces ?? []) as WithAssocReset[]).forEach((b, i) => {
            if (b.associatedReset === oldName) {
              onUpdate?.(['busInterfaces', i, 'associatedReset'], trimmed);
            }
          });
        }
      } else {
        onUpdate?.([arrayName, index, 'name'], trimmed);
      }
    },
    [ipCore, onUpdate]
  );

  const handleSubPortRename = useCallback(
    (subPortId: string, newSuffix: string) => {
      const parts = subPortId.split(':');
      if (parts.length < 3) {
        return;
      }
      const busIndex = parseInt(parts[1], 10);
      const trimmed = newSuffix.trim();
      if (!trimmed) {
        return;
      }

      const bus = (ipCore.busInterfaces ?? [])[busIndex] as
        | { portNameOverrides?: Record<string, string>; conduitPorts?: Array<{ name: string }> }
        | undefined;

      // Conduit ports use index-based IDs: "bus:N:cp:I"
      if (parts[2] === 'cp') {
        const portIndex = parseInt(parts[3], 10);
        if (isNaN(portIndex)) {
          return;
        }
        const conduitPorts = bus?.conduitPorts;
        if (!conduitPorts || portIndex >= conduitPorts.length) {
          return;
        }
        if (trimmed !== conduitPorts[portIndex].name) {
          onUpdate?.(['busInterfaces', busIndex, 'conduitPorts', portIndex, 'name'], trimmed);
        }
        return;
      }

      const portName = parts.slice(2).join(':');

      // Standard bus ports: update the physical suffix via portNameOverrides
      const current = bus?.portNameOverrides ?? {};
      const updated = { ...current };
      if (trimmed === portName.toLowerCase()) {
        delete updated[portName];
      } else {
        updated[portName] = trimmed;
      }
      onUpdate?.(
        ['busInterfaces', busIndex, 'portNameOverrides'],
        Object.keys(updated).length > 0 ? updated : undefined
      );
    },
    [ipCore, onUpdate]
  );

  const openSearch = useCallback(() => setShowSearch(true), []);
  const closeSearch = useCallback(() => {
    setShowSearch(false);
    setSearchQuery('');
  }, []);

  useCanvasKeyboardCommands({
    showSearch,
    openSearch,
    closeSearch,
    exitSelectMode,
    resetView,
  });

  // Auto-focus the search input when the bar opens
  useEffect(() => {
    if (showSearch) {
      searchInputRef.current?.focus();
    }
  }, [showSearch]);

  // Compute which ports/sub-ports match the current search query
  const matchedIds = useMemo<CanvasSearchMatches | null>(() => {
    if (!showSearch || !searchQuery.trim()) {
      return null;
    }
    const q = searchQuery.toLowerCase();
    const portIds = new Set<string>();
    const subPortIds = new Set<string>();

    for (const p of ports) {
      // Always match on the visible label (name)
      if (p.label.toLowerCase().includes(q)) {
        portIds.add(p.id);
        continue;
      }

      // For bus interfaces: also search protocol type, physical prefix, and signal names
      if (p.kind === 'bus') {
        if (p.protocol?.toLowerCase().includes(q)) {
          portIds.add(p.id);
          continue;
        }

        const busData = p.data as {
          type?: string;
          physicalPrefix?: string;
          portNameOverrides?: Record<string, string>;
          conduitPorts?: Array<{ name: string }>;
        };

        if (busData.physicalPrefix?.toLowerCase().includes(q)) {
          portIds.add(p.id);
          continue;
        }

        // Conduit (custom) interface signals
        if (Array.isArray(busData.conduitPorts)) {
          if (busData.conduitPorts.some((cp) => cp.name.toLowerCase().includes(q))) {
            portIds.add(p.id);
            continue;
          }
        }

        // Standard bus signals from the bus definition (covers collapsed buses)
        const busPortDefs = busDefs(busData.type ?? '');
        if (busPortDefs) {
          const prefix = busData.physicalPrefix ?? '';
          const overrides = busData.portNameOverrides ?? {};
          const matched = busPortDefs.some((sig) => {
            if (sig.role) {
              return false;
            }
            const sigName = sig.name.toLowerCase();
            const suffix = overrides[sig.name] ?? sigName;
            return sigName.includes(q) || (prefix + suffix).toLowerCase().includes(q);
          });
          if (matched) {
            portIds.add(p.id);
          }
        }
      }
    }

    // Expanded sub-ports: match by logical name or full physical name
    for (const sp of subPorts) {
      const physical = sp.physicalPrefix + (sp.physicalSuffix ?? sp.name.toLowerCase());
      if (sp.name.toLowerCase().includes(q) || physical.toLowerCase().includes(q)) {
        subPortIds.add(sp.id);
        portIds.add(sp.parentBusId);
      }
    }

    return { portIds, subPortIds };
  }, [showSearch, searchQuery, ports, subPorts, busDefs]);

  return (
    <div
      ref={containerRef}
      className={[
        'ip-canvas-container',
        dragActive ? 'ip-canvas-container--drag-active' : '',
        isPanning ? 'ip-canvas-container--panning' : '',
        portDragActive ? 'ip-canvas-container--port-dragging' : '',
        spaceDown ? 'ip-canvas-container--space-down' : '',
        marqueeRect ? 'ip-canvas-container--marquee' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onDragEnd={handleDragEnd}
      onDoubleClick={(e) => {
        // When the SVG has been panned off-screen the event target is the
        // container div itself (nothing else to click). Center the view.
        if (e.target === e.currentTarget) {
          handleBackgroundDoubleClick();
        }
      }}
    >
      <RemoveZone visible={dragOutActive} />
      <IpBlockDiagram
        layout={layout}
        ipCore={ipCore}
        pan={pan}
        zoom={zoom}
        selectedId={selectedId}
        onSelect={onSelect}
        selectedSubPortId={selectedSubPortId}
        onSelectSubPort={onSelectSubPort}
        hoveredId={hoveredId}
        setHoveredId={setHoveredId}
        blockHovered={blockHovered}
        setBlockHovered={setBlockHovered}
        multiSelectedIds={multiSelectedIds}
        onShiftSelect={onShiftSelect}
        annotations={annotations}
        matchedIds={matchedIds}
        expandedBusIds={expandedBusIds}
        toggleBusExpand={toggleBusExpand}
        busDefs={busDefs}
        getDomainColor={getDomainColor}
        dragActive={dragActive}
        dragHoverSide={dragHoverSide}
        portDragActive={portDragActive}
        portDragActivePIdx={portDragActivePIdx}
        portDragHoveredBus={portDragHoveredBus}
        canDropPorts={!!batchUpdate}
        onPortDropOnBus={handlePortDropOnBus}
        onPortPointerDragStart={handlePortPointerDragStart}
        onSubPortActivate={handleSubPortActivate}
        onSubPortDeactivate={handleSubPortDeactivate}
        onSubPortRename={handleSubPortRename}
        onElementRename={handleElementRename}
        onBackgroundClick={handleBackgroundClick}
        onBackgroundDoubleClick={handleBackgroundDoubleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      />

      <CanvasHud
        ipCore={ipCore}
        ports={ports}
        marqueeRect={marqueeRect}
        hoveredId={hoveredId}
        showZoomIndicator={showZoomIndicator}
        zoom={zoom}
        multiSelectedIds={multiSelectedIds}
        batchUpdate={batchUpdate}
        onDismissSelection={onDismissSelection}
        onExitSelectMode={exitSelectMode}
        suggestionChips={suggestionChips}
        onDismissSuggestion={onDismissSuggestion}
        showSearch={showSearch}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onCloseSearch={closeSearch}
        matchedIds={matchedIds}
        searchInputRef={searchInputRef}
        showHelp={showHelp}
        onToggleHelp={() => setShowHelp((v) => !v)}
      />

      {pendingPortDrop && (
        <div className="ip-canvas-hud">
          <PortMappingOverlay
            ipCore={ipCore}
            pendingPortDrop={pendingPortDrop}
            busDefs={busDefs}
            onConfirm={(opts, busIndex) => {
              groupPorts.mergePortsIntoStandardBus(opts, busIndex);
              const busId = `bus:${busIndex}`;
              setExpandedBusIds((prev) => new Set([...prev, busId]));
              setPendingPortDrop(null);
            }}
            onCancel={() => setPendingPortDrop(null)}
          />
        </div>
      )}
    </div>
  );
};
