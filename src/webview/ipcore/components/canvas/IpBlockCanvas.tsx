import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import type { IpCore } from '../../../types/ipCore';
import { computeLayout } from './canvasLayout';
import { CanvasPort } from './CanvasPort';
import { CanvasBusBundle } from './CanvasBusBundle';
import { CanvasBusSubPort } from './CanvasBusSubPort';
import { RemoveZone } from './RemoveZone';
import { useCanvasValidation } from '../../hooks/useCanvasValidation';
import { lookupBusDef, lookupBusDefFromLibrary, isConduitType } from '../../data/busDefinitions';
import type { BusPortDef } from '../../data/busDefinitions';
import type { YamlUpdateHandler } from '../../../types/editor';
import { DRAG_MIME, getActiveDragPayload, type LibraryDragPayload } from './LibraryPalette';
import { vscode } from '../../../vscode';
import { CanvasSelectionActions } from './CanvasSelectionActions';
import { PortMappingDialog } from './PortMappingDialog';
import type { BatchUpdate } from '../../hooks/useGroupPorts';
import { useGroupPorts } from '../../hooks/useGroupPorts';
import type { SuggestionChip } from '../../hooks/useProtocolSuggestions';
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
}

/**
 * Main canvas component rendering the IP core as an SVG schematic block.
 *
 * The block body sits at center with ports arranged along left, right, and bottom edges.
 * Bus interfaces render as wide "bundle" connectors; clocks/resets/ports as thin stubs.
 * Bus bundles can be expanded to show individual port signals.
 */
export const IpBlockCanvas: React.FC<IpBlockCanvasProps> = ({
  ipCore,
  selectedId,
  onSelect,
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
}) => {
  // Pending port-drop-on-standard-bus confirmation state
  const [pendingPortDrop, setPendingPortDrop] = useState<{
    portIndex: number;
    busIndex: number;
  } | null>(null);
  const [expandedBusIds, setExpandedBusIds] = useState<Set<string>>(new Set());
  // Multi-select mode: when on, port clicks act as shift-clicks without holding Shift
  const [multiSelectMode, setMultiSelectMode] = useState(false);

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
  const [dragActive, setDragActive] = useState(false);
  const [dragOutActive, setDragOutActive] = useState(false);
  const [dragHoverSide, setDragHoverSide] = useState<'left' | 'right' | null>(null);

  const [zoom, setZoom] = useState(1.0);
  const [showZoomIndicator, setShowZoomIndicator] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  /** Always reflects the latest pan values — readable in non-React event listeners */
  const currentPanRef = useRef({ x: 0, y: 0 });
  /** Active pointer-drag state; null when no drag is in progress */
  const dragRef = useRef<{
    startMouseX: number;
    startMouseY: number;
    startPanX: number;
    startPanY: number;
    hasMoved: boolean;
  } | null>(null);
  /** True when the last mousedown turned into a drag; prevents onClick from deselecting */
  const hasDraggedRef = useRef(false);

  const triggerZoomIndicator = useCallback(() => {
    setShowZoomIndicator(true);
    if (zoomTimerRef.current) {
      clearTimeout(zoomTimerRef.current);
    }
    zoomTimerRef.current = setTimeout(() => setShowZoomIndicator(false), 1500);
  }, []);

  // Ctrl+Wheel → zoom; plain wheel → pan
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        setZoom((prev) => {
          const next = Math.min(4, Math.max(0.1, prev * factor));
          return Math.round(next * 100) / 100;
        });
        triggerZoomIndicator();
      } else {
        const newX = currentPanRef.current.x - e.deltaX;
        const newY = currentPanRef.current.y - e.deltaY;
        currentPanRef.current = { x: newX, y: newY };
        setPan({ x: newX, y: newY });
      }
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [triggerZoomIndicator]);

  // Middle-mouse-button drag + left-button drag on canvas background → pan
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const isBackgroundTarget = (target: EventTarget | null): boolean => {
      if (!target || !(target instanceof Element)) {
        return false;
      }
      return (
        target.classList.contains('ip-canvas-background') || target.tagName.toLowerCase() === 'svg'
      );
    };

    const onMouseDown = (e: MouseEvent) => {
      const isMiddle = e.button === 1;
      const isLeftBackground = e.button === 0 && isBackgroundTarget(e.target);
      if (!isMiddle && !isLeftBackground) {
        return;
      }
      if (isMiddle) {
        e.preventDefault(); // suppress browser auto-scroll cursor
      }
      hasDraggedRef.current = false;
      dragRef.current = {
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startPanX: currentPanRef.current.x,
        startPanY: currentPanRef.current.y,
        hasMoved: false,
      };
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) {
        return;
      }
      const dx = e.clientX - dragRef.current.startMouseX;
      const dy = e.clientY - dragRef.current.startMouseY;
      if (!dragRef.current.hasMoved && Math.abs(dx) + Math.abs(dy) > 4) {
        dragRef.current.hasMoved = true;
        hasDraggedRef.current = true;
        setIsPanning(true);
      }
      if (dragRef.current.hasMoved) {
        const newX = dragRef.current.startPanX + dx;
        const newY = dragRef.current.startPanY + dy;
        currentPanRef.current = { x: newX, y: newY };
        setPan({ x: newX, y: newY });
      }
    };

    const onMouseUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        setIsPanning(false);
      }
    };

    container.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const annotations = useCanvasValidation(ipCore);

  // Group ports hook — only instantiated when batchUpdate is available
  const noopBatch: BatchUpdate = useCallback(() => {}, []);
  const groupPorts = useGroupPorts(ipCore, batchUpdate ?? noopBatch);

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
        // Custom / conduit interface: append to conduitPorts immediately
        groupPorts.addPortToConduit(portIndex, busIndex);
      } else {
        // Standard known protocol: confirm before removing from standalone list
        setPendingPortDrop({ portIndex, busIndex });
      }
    },
    [batchUpdate, groupPorts, ipCore]
  );

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
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
    currentPanRef.current = { x: 0, y: 0 };
    triggerZoomIndicator();
  }, [triggerZoomIndicator]);

  // In multi-select mode, port/interrupt clicks become shift-selects without Shift key.
  // Non-groupable ports (clock, reset, bus) still single-select normally.
  const effectiveOnSelect = useCallback(
    (id: string | null) => {
      if (id !== null && multiSelectMode && onShiftSelect) {
        const kind = id.split(':')[0];
        if (kind === 'port' || kind === 'interrupt') {
          onShiftSelect(id);
          return;
        }
      }
      onSelect(id);
    },
    [multiSelectMode, onShiftSelect, onSelect]
  );

  // Exits multi-select mode AND dismisses any active selection.
  const exitSelectMode = useCallback(() => {
    setMultiSelectMode(false);
    onSelect(null);
    onDismissSelection?.();
  }, [onSelect, onDismissSelection]);

  const toggleMultiSelectMode = useCallback(() => {
    setMultiSelectMode((prev) => {
      if (prev) {
        onSelect(null);
        onDismissSelection?.();
      }
      return !prev;
    });
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

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input or textarea
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') {
        return;
      }

      if (e.key === 'Escape') {
        exitSelectMode();
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        setZoom(1.0);
        setPan({ x: 0, y: 0 });
        currentPanRef.current = { x: 0, y: 0 };
        triggerZoomIndicator();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, onSelect, onRemove, onDismissSelection, triggerZoomIndicator, exitSelectMode]);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      // When dragging a port-to-bus (PORT_MOVE_MIME present), don't show the
      // RemoveZone — the user is targeting a bus bundle, not deleting the port.
      if (e.dataTransfer.types.includes('application/x-ipcraft-remove')) {
        if (!e.dataTransfer.types.includes('application/x-ipcraft-port-move')) {
          e.preventDefault();
          setDragOutActive(true);
        }
        return;
      }

      setDragActive(true);

      if (e.dataTransfer.types.includes(DRAG_MIME)) {
        const svgEl = e.currentTarget as Element;
        const rect = svgEl.getBoundingClientRect();
        setDragHoverSide((e.clientX - rect.left) / rect.width < 0.5 ? 'left' : 'right');
      }

      onDragOver?.(e);
    },
    [onDragOver]
  );

  const handleDragLeave = useCallback(() => {
    setDragActive(false);
    setDragOutActive(false);
    setDragHoverSide(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setDragActive(false);
      setDragOutActive(false);
      setDragHoverSide(null);

      if (e.dataTransfer.types.includes('application/x-ipcraft-remove')) {
        try {
          const payloadStr = e.dataTransfer.getData('application/x-ipcraft-remove');
          if (payloadStr) {
            const payload = JSON.parse(payloadStr) as {
              action?: string;
              kind?: string;
              id?: string;
            };
            if (payload.action === 'remove' && payload.kind && payload.id) {
              onRemove?.(payload.kind, payload.id);
            }
          }
        } catch (err) {
          console.error('Failed to parse remove drop payload', err);
        }
        return;
      }

      onDrop?.(e);
    },
    [onDrop, onRemove]
  );

  const {
    blockRect,
    ports,
    subPorts,
    viewBox,
    coreName,
    vlnvLabel,
    parameters,
    paramSeparatorY,
    portSeparatorY,
    descLines,
    descSeparatorY,
    subcoreDeps,
    depSeparatorY,
  } = layout;

  return (
    <div
      ref={containerRef}
      className={[
        'ip-canvas-container',
        dragActive ? 'ip-canvas-container--drag-active' : '',
        isPanning ? 'ip-canvas-container--panning' : '',
        multiSelectMode ? 'ip-canvas-container--selecting' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onDragEnd={() => setDragOutActive(false)}
      onDoubleClick={(e) => {
        // When the SVG has been panned off-screen the event target is the
        // container div itself (nothing else to click). Center the view.
        if (e.target === e.currentTarget) {
          handleBackgroundDoubleClick();
        }
      }}
    >
      <RemoveZone visible={dragOutActive} />
      <svg
        className="ip-canvas-svg"
        viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
        overflow="visible"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
        }}
        onClick={handleBackgroundClick}
        onDoubleClick={handleBackgroundDoubleClick}
        onMouseLeave={() => setHoveredId(null)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Grid background pattern */}
        <defs>
          <pattern id="canvas-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.5" className="ip-canvas-grid-dot" />
          </pattern>
        </defs>
        <rect
          className="ip-canvas-background"
          width="100%"
          height="100%"
          fill="url(#canvas-grid)"
        />

        {/* Block body — clickable to open VLNV inspector */}
        <rect
          x={blockRect.x}
          y={blockRect.y}
          width={blockRect.width}
          height={blockRect.height}
          className={`ip-block-body${selectedId === 'body' ? ' ip-block-body--selected' : ''}${blockHovered ? ' ip-block-body--hovered' : ''}`}
          rx={6}
          ry={6}
          style={{ cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation();
            onSelect('body');
          }}
          onMouseEnter={() => setBlockHovered(true)}
          onMouseLeave={() => setBlockHovered(false)}
        />

        {/* Block header stripe */}
        <rect
          x={blockRect.x}
          y={blockRect.y}
          width={blockRect.width}
          height={28}
          className="ip-block-header"
          rx={6}
          ry={6}
          style={{ pointerEvents: 'none' }}
        />
        {/* Square off bottom corners of header */}
        <rect
          x={blockRect.x}
          y={blockRect.y + 14}
          width={blockRect.width}
          height={14}
          className="ip-block-header"
          style={{ pointerEvents: 'none' }}
        />

        {/* Core name */}
        <text
          x={blockRect.x + blockRect.width / 2}
          y={blockRect.y + 15}
          textAnchor="middle"
          dominantBaseline="central"
          className="ip-block-name"
          style={{ pointerEvents: 'none' }}
        >
          {coreName}
        </text>

        {/* VLNV subtitle */}
        <text
          x={blockRect.x + blockRect.width / 2}
          y={blockRect.y + 42}
          textAnchor="middle"
          dominantBaseline="central"
          className="ip-block-vlnv"
          style={{ pointerEvents: 'none' }}
        >
          {vlnvLabel}
        </text>

        {/* Edit hint — visible when block is hovered or body is selected */}
        {(blockHovered || selectedId === 'body') && (
          <text
            x={blockRect.x + blockRect.width - 8}
            y={blockRect.y + 15}
            textAnchor="end"
            dominantBaseline="central"
            className="ip-block-edit-hint"
            style={{ pointerEvents: 'none' }}
          >
            ✎
          </text>
        )}

        {/* ── Dependencies (subcores) section inside block ── */}
        {subcoreDeps.length > 0 && (
          <g style={{ pointerEvents: 'none' }}>
            {/* Separator line above the section */}
            <line
              x1={blockRect.x + 8}
              y1={depSeparatorY}
              x2={blockRect.x + blockRect.width - 8}
              y2={depSeparatorY}
              className="ip-block-dep-separator"
            />
            {/* "Dependencies" header */}
            <text
              x={blockRect.x + blockRect.width / 2}
              y={depSeparatorY + 11}
              textAnchor="middle"
              dominantBaseline="central"
              className="ip-block-dep-header"
            >
              Dependencies
            </text>
          </g>
        )}
        {subcoreDeps.map((dep) => {
          const isDepSelected = selectedId === `subcore:${dep.index}`;
          return (
            <g
              key={dep.index}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(`subcore:${dep.index}`);
              }}
              style={{ cursor: 'pointer' }}
            >
              {/* Hit + selection highlight */}
              <rect
                x={blockRect.x + 4}
                y={dep.y - 8}
                width={blockRect.width - 8}
                height={16}
                rx={3}
                className={`ip-block-dep-row-bg${isDepSelected ? ' ip-block-dep-row-bg--selected' : ''}`}
              />
              {/* Chain-link icon */}
              <text
                x={blockRect.x + 14}
                y={dep.y}
                textAnchor="middle"
                dominantBaseline="central"
                className="ip-block-dep-icon"
                style={{ pointerEvents: 'none' }}
              >
                ⛓
              </text>
              {/* Short name */}
              <text
                x={blockRect.x + 24}
                y={dep.y}
                dominantBaseline="central"
                className="ip-block-dep-name"
                style={{ pointerEvents: 'none' }}
              >
                {dep.shortName}
              </text>
            </g>
          );
        })}

        {/* ── Generic / parameter section inside block ── */}
        {parameters.length > 0 && (
          <g style={{ pointerEvents: 'none' }}>
            {/* Separator */}
            <line
              x1={blockRect.x + 8}
              y1={paramSeparatorY}
              x2={blockRect.x + blockRect.width - 8}
              y2={paramSeparatorY}
              className="ip-block-param-separator"
            />
            {/* Section header */}
            <text
              x={blockRect.x + blockRect.width / 2}
              y={paramSeparatorY + 11}
              textAnchor="middle"
              dominantBaseline="central"
              className="ip-block-param-header"
            >
              Generics
            </text>
          </g>
        )}
        {parameters.map((param) => {
          const rowY = paramSeparatorY + 26 + param.index * 18;
          const isParamSelected = selectedId === `parameter:${param.index}`;
          return (
            <g
              key={param.index}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(`parameter:${param.index}`);
              }}
              style={{ cursor: 'pointer' }}
            >
              {/* Hit + selection highlight */}
              <rect
                x={blockRect.x + 4}
                y={rowY - 8}
                width={blockRect.width - 8}
                height={16}
                rx={3}
                className={`ip-block-param-row-bg${isParamSelected ? ' ip-block-param-row-bg--selected' : ''}`}
              />
              {/* Generic icon */}
              <text
                x={blockRect.x + 14}
                y={rowY}
                textAnchor="middle"
                dominantBaseline="central"
                className="ip-block-param-icon"
                style={{ pointerEvents: 'none' }}
              >
                ⊳
              </text>
              {/* Name */}
              <text
                x={blockRect.x + 24}
                y={rowY}
                dominantBaseline="central"
                className="ip-block-param-name"
                style={{ pointerEvents: 'none' }}
              >
                {param.name}
              </text>
              {/* Default value */}
              {param.value !== '' && (
                <text
                  x={blockRect.x + blockRect.width - 8}
                  y={rowY}
                  textAnchor="end"
                  dominantBaseline="central"
                  className="ip-block-param-value"
                  style={{ pointerEvents: 'none' }}
                >
                  = {param.value}
                </text>
              )}
            </g>
          );
        })}

        {/* Second separator — below generics/deps, above where port stubs connect */}
        {(parameters.length > 0 || subcoreDeps.length > 0) && (
          <line
            x1={blockRect.x + 8}
            y1={portSeparatorY}
            x2={blockRect.x + blockRect.width - 8}
            y2={portSeparatorY}
            className="ip-block-param-separator"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Description section — separator + word-wrapped text below the last port */}
        {descLines.length > 0 && (
          <>
            <line
              x1={blockRect.x + 12}
              y1={descSeparatorY}
              x2={blockRect.x + blockRect.width - 12}
              y2={descSeparatorY}
              className="ip-block-param-separator"
            />
            <text
              textAnchor="middle"
              className="ip-block-description"
              style={{ pointerEvents: 'none' }}
            >
              {descLines.map((line, i) => (
                <tspan
                  key={i}
                  x={blockRect.x + blockRect.width / 2}
                  y={descSeparatorY + 10 + (i + 0.5) * 13}
                >
                  {line}
                </tspan>
              ))}
            </text>
          </>
        )}

        {/* Half-zone drop hint — clipped to block rect, rendered before ports so ports stay on top */}
        {dragActive &&
          (() => {
            const labels = getDragHintLabels(getActiveDragPayload());
            if (!labels) {
              return null;
            }
            const halfW = blockRect.width / 2;
            const midY = blockRect.y + blockRect.height / 2;
            return (
              <g style={{ pointerEvents: 'none' }}>
                <defs>
                  <clipPath id="ip-canvas-block-clip">
                    <rect
                      x={blockRect.x}
                      y={blockRect.y}
                      width={blockRect.width}
                      height={blockRect.height}
                      rx={6}
                      ry={6}
                    />
                  </clipPath>
                </defs>
                <g clipPath="url(#ip-canvas-block-clip)">
                  <rect
                    x={blockRect.x}
                    y={blockRect.y}
                    width={halfW}
                    height={blockRect.height}
                    className={`ip-canvas-drop-half${dragHoverSide === 'left' ? ' ip-canvas-drop-half--active' : ''}`}
                  />
                  <rect
                    x={blockRect.x + halfW}
                    y={blockRect.y}
                    width={halfW}
                    height={blockRect.height}
                    className={`ip-canvas-drop-half${dragHoverSide === 'right' ? ' ip-canvas-drop-half--active' : ''}`}
                  />
                </g>
                <line
                  x1={blockRect.x + halfW}
                  y1={blockRect.y + 8}
                  x2={blockRect.x + halfW}
                  y2={blockRect.y + blockRect.height - 8}
                  className="ip-canvas-drop-divider"
                />
                <text
                  x={blockRect.x + halfW / 2}
                  y={midY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={`ip-canvas-drop-label${dragHoverSide === 'left' ? ' ip-canvas-drop-label--active' : ''}`}
                >
                  {labels.left}
                </text>
                <text
                  x={blockRect.x + halfW * 1.5}
                  y={midY}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className={`ip-canvas-drop-label${dragHoverSide === 'right' ? ' ip-canvas-drop-label--active' : ''}`}
                >
                  {labels.right}
                </text>
              </g>
            );
          })()}

        {/* Port stubs */}
        {(() => {
          const mmImportPath = (ipCore.memoryMaps as unknown as Record<string, unknown> | undefined)
            ?.import as string | undefined;
          return ports.map((p) => {
            const isSelected = selectedId === p.id;
            const isHovered = hoveredId === p.id;
            const busExpanded = p.kind === 'bus' && expandedBusIds.has(p.id);
            const busType = (p.data as { type?: string; conduitPorts?: unknown[] }).type ?? '';
            const hasConduitPorts = Array.isArray(
              (p.data as { conduitPorts?: unknown[] }).conduitPorts
            );
            const hasBusDef = p.kind === 'bus' && (hasConduitPorts || busDefs(busType) !== null);

            if (p.kind === 'bus') {
              const mmClickPath = p.memoryMapRef ? mmImportPath : undefined;
              return (
                <g
                  key={p.id}
                  onMouseEnter={() => setHoveredId(p.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  className={isHovered ? 'canvas-element--hovered' : ''}
                >
                  <CanvasBusBundle
                    port={p}
                    selected={isSelected}
                    annotations={annotations[p.id]}
                    onPortDrop={
                      batchUpdate
                        ? (portIndex) =>
                            handlePortDropOnBus(portIndex, parseInt(p.id.split(':')[1] ?? '0', 10))
                        : undefined
                    }
                    onSelect={onSelect}
                    isExpanded={busExpanded}
                    onToggleExpand={hasBusDef ? () => toggleBusExpand(p.id) : undefined}
                    domainColor={getDomainColor(p.clockDomainIdx)}
                    onMemoryMapClick={
                      mmClickPath
                        ? () =>
                            vscode?.postMessage({
                              type: 'command',
                              command: 'openFile',
                              path: mmClickPath,
                            })
                        : undefined
                    }
                  />
                </g>
              );
            }

            return (
              <g
                key={p.id}
                onMouseEnter={() => setHoveredId(p.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={isHovered ? 'canvas-element--hovered' : ''}
              >
                <CanvasPort
                  port={p}
                  selected={isSelected}
                  inMultiSelection={multiSelectedIds?.has(p.id) ?? false}
                  annotations={annotations[p.id]}
                  onSelect={effectiveOnSelect}
                  onShiftSelect={onShiftSelect}
                  multiSelectMode={multiSelectMode && (p.kind === 'port' || p.kind === 'interrupt')}
                  domainColor={getDomainColor(p.clockDomainIdx)}
                />
              </g>
            );
          });
        })()}

        {/* Sub-ports for expanded bus interfaces */}
        {subPorts.map((sp) => (
          <CanvasBusSubPort
            key={sp.id}
            subPort={sp}
            onActivate={handleSubPortActivate}
            onDeactivate={handleSubPortDeactivate}
            onSelect={onSelect}
            domainColor={getDomainColor(sp.clockDomainIdx)}
          />
        ))}

        {/* Port count badges on block edges */}
        {renderEdgeBadge(ports, 'left', blockRect)}
        {renderEdgeBadge(ports, 'right', blockRect)}

        {/* Drop zone overlay (visible during drag) */}
        {dragActive && (
          <rect
            x={blockRect.x - 8}
            y={blockRect.y - 8}
            width={blockRect.width + 16}
            height={blockRect.height + 16}
            rx={10}
            ry={10}
            className="ip-canvas-drop-zone"
          />
        )}
      </svg>

      {/* Hover tooltip */}
      {hoveredId && <PortTooltip portId={hoveredId} ports={ports} />}

      {/* Zoom level indicator — fades after 1.5 s */}
      {showZoomIndicator && (
        <div className="ip-canvas-zoom-indicator">{Math.round(zoom * 100)}%</div>
      )}

      {/* HUD layer — sits outside the SVG transform, pinned to container viewport */}
      <div className="ip-canvas-hud">
        {/* Multi-select toolbar */}
        {multiSelectedIds && multiSelectedIds.size >= 1 && batchUpdate && onDismissSelection && (
          <CanvasSelectionActions
            multiSelection={{ all: buildMultiSelectionMap(multiSelectedIds), isMulti: true }}
            ipCore={ipCore}
            batchUpdate={batchUpdate}
            onDismiss={exitSelectMode}
          />
        )}

        {/* Protocol suggestion chips */}
        {suggestionChips && suggestionChips.length > 0 && (
          <div className="ip-canvas-suggestion-chips">
            {suggestionChips.map((chip) => (
              <div key={chip.id} className="ip-canvas-suggestion-chip">
                <span>
                  ⚡ {chip.label} detected ({Math.round(chip.score * 100)}%)
                </span>
                <button
                  className="ip-canvas-suggestion-chip__group-btn"
                  onClick={() => {
                    if (!batchUpdate || !onDismissSuggestion) {
                      return;
                    }
                    // Accept suggestion — dismisses chip; user can also use multi-select
                    onDismissSuggestion(chip.id);
                  }}
                >
                  Group ▸
                </button>
                <button
                  className="ip-canvas-suggestion-chip__dismiss-btn"
                  onClick={() => onDismissSuggestion?.(chip.id)}
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Multi-select mode toggle — always visible when grouping is available */}
        {onShiftSelect && (
          <button
            className={`ip-canvas-multiselect-btn${multiSelectMode ? ' ip-canvas-multiselect-btn--active' : ''}`}
            onClick={toggleMultiSelectMode}
            title={
              multiSelectMode
                ? 'Exit selection mode (Escape)'
                : 'Select multiple ports (click ports to add, Escape to cancel)'
            }
          >
            {multiSelectMode ? '✓ Selecting…' : '⊕ Select ports'}
          </button>
        )}

        {/* Port-on-standard-bus confirmation dialog */}
        {pendingPortDrop && (
          <PortMappingDialog
            ipCore={ipCore}
            portIndex={pendingPortDrop.portIndex}
            busIndex={pendingPortDrop.busIndex}
            onConfirm={() => {
              // Standard-protocol bus: the port's physical name already matches
              // physicalPrefix, so just remove it from the standalone ports list.
              if (batchUpdate) {
                groupPorts.removeStandalonePort(pendingPortDrop.portIndex);
              }
              setPendingPortDrop(null);
            }}
            onCancel={() => setPendingPortDrop(null)}
          />
        )}
      </div>
    </div>
  );
};

// --- Helper sub-components ---

function getDragHintLabels(
  payload: LibraryDragPayload | null
): { left: string; right: string } | null {
  if (!payload) {
    return null;
  }
  switch (payload.kind) {
    case 'port':
      return { left: '▶  IN', right: 'OUT  ▶' };
    case 'interrupt':
      return { left: '▶  IRQ IN', right: 'IRQ OUT  ▶' };
    case 'bus': {
      return { left: 'SLAVE', right: 'MASTER' };
    }
    default:
      return null;
  }
}

function buildMultiSelectionMap(
  ids: Set<string>
): Map<string, { kind: 'port' | 'interrupt'; index: number; id: string }> {
  const map = new Map<string, { kind: 'port' | 'interrupt'; index: number; id: string }>();
  for (const id of ids) {
    const parts = id.split(':');
    if (parts.length !== 2) {
      continue;
    }
    const [kindRaw, indexStr] = parts;
    const index = parseInt(indexStr, 10);
    if (isNaN(index)) {
      continue;
    }
    if (kindRaw === 'port' || kindRaw === 'interrupt') {
      map.set(id, { kind: kindRaw, index, id });
    }
  }
  return map;
}

function renderEdgeBadge(
  ports: ReturnType<typeof computeLayout>['ports'],
  side: 'left' | 'right',
  blockRect: { x: number; y: number; width: number; height: number }
) {
  const count = ports.filter((p) => p.side === side).length;
  if (count === 0) {
    return null;
  }

  const x = side === 'left' ? blockRect.x + 12 : blockRect.x + blockRect.width - 12;
  const y = blockRect.y + blockRect.height - 8;

  return (
    <text x={x} y={y} textAnchor="middle" className="ip-block-edge-count">
      {count}
    </text>
  );
}

interface PortTooltipProps {
  portId: string;
  ports: ReturnType<typeof computeLayout>['ports'];
}

const PortTooltip: React.FC<PortTooltipProps> = ({ portId, ports }) => {
  const port = ports.find((p) => p.id === portId);
  if (!port) {
    return null;
  }

  const details: string[] = [port.label];
  if (port.kind === 'bus' && port.protocol) {
    details.push(`Protocol: ${port.protocol}`);
    if (port.mode) {
      details.push(`Mode: ${port.mode}`);
    }
    const bus = port.data as { associatedClock?: string | null; associatedReset?: string | null };
    if (bus.associatedClock) {
      details.push(`Clock: ${bus.associatedClock}`);
    }
    if (bus.associatedReset) {
      details.push(`Reset: ${bus.associatedReset}`);
    }
  }
  if (port.widthLabel) {
    details.push(`Width: ${port.widthLabel}`);
  }
  if (port.kind === 'clock') {
    const clk = port.data as { frequency?: string | null };
    if (clk.frequency) {
      details.push(`Freq: ${clk.frequency}`);
    }
  }
  if (port.kind === 'reset') {
    const rst = port.data as { polarity?: string };
    if (rst.polarity) {
      details.push(`Polarity: ${rst.polarity}`);
    }
  }
  if (port.kind === 'interrupt') {
    const irq = port.data as { sensitivity?: string; direction?: string };
    details.push(`Direction: ${irq.direction ?? 'out'}`);
    if (irq.sensitivity) {
      details.push(`Sensitivity: ${irq.sensitivity}`);
    }
  }

  return (
    <div className="ip-canvas-tooltip">
      {details.map((line, i) => (
        <div key={i} className={i === 0 ? 'ip-canvas-tooltip__title' : 'ip-canvas-tooltip__detail'}>
          {line}
        </div>
      ))}
    </div>
  );
};
