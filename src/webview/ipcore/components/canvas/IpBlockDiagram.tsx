import React from 'react';
import type { CanvasLayout, LayoutPort } from './canvasLayout';
import { resolveMemoryMapImportPath } from './canvasLayout';
import { CanvasPort } from './CanvasPort';
import { CanvasBusBundle } from './CanvasBusBundle';
import { CanvasBusSubPort } from './CanvasBusSubPort';
import type { CanvasAnnotations } from '../../hooks/useCanvasValidation';
import type { BusPortDef } from '../../data/busDefinitions';
import { getActiveDragPayload, type LibraryDragPayload } from './canvasDragTypes';
import { vscode } from '../../../vscode';
import type { IpCore } from '../../../types/ipCore';

export interface CanvasSearchMatches {
  portIds: Set<string>;
  subPortIds: Set<string>;
}

interface IpBlockDiagramProps {
  layout: CanvasLayout;
  ipCore: IpCore;
  pan: { x: number; y: number };
  zoom: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  selectedSubPortId: string | null;
  onSelectSubPort?: (subPortId: string) => void;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  blockHovered: boolean;
  setBlockHovered: (hovered: boolean) => void;
  multiSelectedIds?: Set<string>;
  onShiftSelect?: (id: string) => void;
  annotations: CanvasAnnotations;
  matchedIds: CanvasSearchMatches | null;
  expandedBusIds: Set<string>;
  toggleBusExpand: (busId: string) => void;
  busDefs: (type: string) => BusPortDef[] | null;
  getDomainColor: (idx: number) => string | undefined;
  dragActive: boolean;
  dragHoverSide: 'left' | 'right' | null;
  portDragActive: boolean;
  portDragActivePIdx: number | null;
  portDragHoveredBus: number | null;
  canDropPorts: boolean;
  onPortDropOnBus: (portIndex: number, busIndex: number) => void;
  onPortPointerDragStart?: (portIndex: number, clientX: number, clientY: number) => void;
  onSubPortActivate: (subPortId: string) => void;
  onSubPortDeactivate: (subPortId: string) => void;
  onSubPortRename: (subPortId: string, newSuffix: string) => void;
  onElementRename: (id: string, newName: string) => void;
  onBackgroundClick: (e: React.MouseEvent) => void;
  onBackgroundDoubleClick: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

/**
 * Renders the IP core SVG schematic: block body, its inner sections
 * (dependencies, generics, ports header, description), port stubs around the
 * edges, and expanded bus sub-ports. Pure rendering — all interaction state
 * (viewport, drag, selection, search) is owned by `IpBlockCanvas` and passed
 * down as props/callbacks.
 */
export const IpBlockDiagram: React.FC<IpBlockDiagramProps> = ({
  layout,
  ipCore,
  pan,
  zoom,
  selectedId,
  onSelect,
  selectedSubPortId,
  onSelectSubPort,
  hoveredId,
  setHoveredId,
  blockHovered,
  setBlockHovered,
  multiSelectedIds,
  onShiftSelect,
  annotations,
  matchedIds,
  expandedBusIds,
  toggleBusExpand,
  busDefs,
  getDomainColor,
  dragActive,
  dragHoverSide,
  portDragActive,
  portDragActivePIdx,
  portDragHoveredBus,
  canDropPorts,
  onPortDropOnBus,
  onPortPointerDragStart,
  onSubPortActivate,
  onSubPortDeactivate,
  onSubPortRename,
  onElementRename,
  onBackgroundClick,
  onBackgroundDoubleClick,
  onDragOver,
  onDragLeave,
  onDrop,
}) => {
  const {
    blockRect,
    ports,
    subPorts,
    viewBox,
    coreName,
    vendorLabel,
    libraryLabel,
    authorLabel,
    parameters,
    paramSeparatorY,
    portSeparatorY,
    descLines,
    descSeparatorY,
    subcoreDeps,
    depSeparatorY,
  } = layout;

  const memoryMaps = ipCore.memoryMaps as unknown;

  return (
    <svg
      className="ip-canvas-svg"
      viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
      preserveAspectRatio="xMidYMid meet"
      overflow="visible"
      style={{
        transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        transformOrigin: 'center center',
      }}
      onClick={onBackgroundClick}
      onDoubleClick={onBackgroundDoubleClick}
      onMouseLeave={() => setHoveredId(null)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {/* Grid background pattern */}
      <defs>
        <pattern id="canvas-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.5" className="ip-canvas-grid-dot" />
        </pattern>
      </defs>
      <rect className="ip-canvas-background" width="100%" height="100%" fill="url(#canvas-grid)" />

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

      {/* Vendor subtitle */}
      <text
        x={blockRect.x + 24}
        y={blockRect.y + 42}
        dominantBaseline="central"
        className="ip-block-param-name"
        style={{ pointerEvents: 'none' }}
      >
        vendor
      </text>
      <text
        x={blockRect.x + blockRect.width - 24}
        y={blockRect.y + 42}
        textAnchor="end"
        dominantBaseline="central"
        className="ip-block-param-value"
        style={{ pointerEvents: 'none' }}
      >
        {vendorLabel}
      </text>

      {/* Library subtitle */}
      <text
        x={blockRect.x + 24}
        y={blockRect.y + 62}
        dominantBaseline="central"
        className="ip-block-param-name"
        style={{ pointerEvents: 'none' }}
      >
        library
      </text>
      <text
        x={blockRect.x + blockRect.width - 24}
        y={blockRect.y + 62}
        textAnchor="end"
        dominantBaseline="central"
        className="ip-block-param-value"
        style={{ pointerEvents: 'none' }}
      >
        {libraryLabel}
      </text>

      {/* Author subtitle — only rendered when set */}
      {authorLabel && (
        <>
          <text
            x={blockRect.x + 24}
            y={blockRect.y + 82}
            dominantBaseline="central"
            className="ip-block-param-name"
            style={{ pointerEvents: 'none' }}
          >
            author
          </text>
          <text
            x={blockRect.x + blockRect.width - 24}
            y={blockRect.y + 82}
            textAnchor="end"
            dominantBaseline="central"
            className="ip-block-param-value"
            style={{ pointerEvents: 'none' }}
          >
            {authorLabel}
          </text>
        </>
      )}

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
        <g
          onClick={(e) => {
            e.stopPropagation();
            onSelect('generics');
          }}
          style={{ cursor: 'pointer' }}
        >
          {/* Separator */}
          <line
            x1={blockRect.x + 8}
            y1={paramSeparatorY}
            x2={blockRect.x + blockRect.width - 8}
            y2={paramSeparatorY}
            className="ip-block-param-separator"
            style={{ pointerEvents: 'none' }}
          />
          {/* Hit + selection highlight */}
          <rect
            x={blockRect.x + 4}
            y={paramSeparatorY + 3}
            width={blockRect.width - 8}
            height={16}
            rx={3}
            className={`ip-block-param-row-bg${selectedId === 'generics' ? ' ip-block-param-row-bg--selected' : ''}`}
          />
          {/* Section header */}
          <text
            x={blockRect.x + blockRect.width / 2}
            y={paramSeparatorY + 11}
            textAnchor="middle"
            dominantBaseline="central"
            className="ip-block-param-header"
            style={{ pointerEvents: 'none' }}
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

      {/* Ports header — below generics/deps, clickable to open the Bus Interface clock/reset matrix */}
      {ports.length > 0 && (
        <g
          onClick={(e) => {
            e.stopPropagation();
            onSelect('busInterfaceMatrix');
          }}
          style={{ cursor: 'pointer' }}
        >
          {/* Separator */}
          <line
            x1={blockRect.x + 8}
            y1={portSeparatorY}
            x2={blockRect.x + blockRect.width - 8}
            y2={portSeparatorY}
            className="ip-block-param-separator"
            style={{ pointerEvents: 'none' }}
          />
          {/* Hit + selection highlight */}
          <rect
            x={blockRect.x + 4}
            y={portSeparatorY + 3}
            width={blockRect.width - 8}
            height={16}
            rx={3}
            className={`ip-block-ports-row-bg${selectedId === 'busInterfaceMatrix' ? ' ip-block-ports-row-bg--selected' : ''}`}
          />
          {/* Section header */}
          <text
            x={blockRect.x + blockRect.width / 2}
            y={portSeparatorY + 11}
            textAnchor="middle"
            dominantBaseline="central"
            className="ip-block-ports-header"
            style={{ pointerEvents: 'none' }}
          >
            Ports
          </text>
        </g>
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
      {ports.map((p) => {
        const isSelected = selectedId === p.id;
        const isHovered = hoveredId === p.id;
        const busExpanded = p.kind === 'bus' && expandedBusIds.has(p.id);
        const busType = (p.data as { type?: string; conduitPorts?: unknown[] }).type ?? '';
        const hasConduitPorts = Array.isArray(
          (p.data as { conduitPorts?: unknown[] }).conduitPorts
        );
        const hasBusDef = p.kind === 'bus' && (hasConduitPorts || busDefs(busType) !== null);

        if (p.kind === 'bus') {
          const mmClickPath = resolveMemoryMapImportPath(memoryMaps, p.memoryMapRef);
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
                  canDropPorts
                    ? (portIndex) =>
                        onPortDropOnBus(portIndex, parseInt(p.id.split(':')[1] ?? '0', 10))
                    : undefined
                }
                isPortDropTarget={
                  portDragActive && portDragHoveredBus === parseInt(p.id.split(':')[1] ?? '-1', 10)
                }
                onSelect={onSelect}
                isExpanded={busExpanded}
                onToggleExpand={hasBusDef ? () => toggleBusExpand(p.id) : undefined}
                domainColor={getDomainColor(p.clockDomainIdx)}
                dimmed={matchedIds !== null && !matchedIds.portIds.has(p.id)}
                onMemoryMapClick={
                  mmClickPath
                    ? () =>
                        vscode?.postMessage({
                          type: 'openFile',
                          path: mmClickPath,
                        })
                    : undefined
                }
                onRename={onElementRename}
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
              onSelect={onSelect}
              onShiftSelect={onShiftSelect}
              domainColor={getDomainColor(p.clockDomainIdx)}
              onPortDragStart={canDropPorts ? onPortPointerDragStart : undefined}
              isDragging={
                portDragActivePIdx !== null &&
                portDragActivePIdx === parseInt(p.id.split(':')[1] ?? '-1', 10)
              }
              onRename={onElementRename}
              dimmed={matchedIds !== null && !matchedIds.portIds.has(p.id)}
            />
          </g>
        );
      })}

      {/* Sub-ports for expanded bus interfaces */}
      {subPorts.map((sp) => (
        <CanvasBusSubPort
          key={sp.id}
          subPort={sp}
          onActivate={onSubPortActivate}
          onDeactivate={onSubPortDeactivate}
          onSelect={onSelect}
          onSelectSignal={onSelectSubPort}
          isSelected={sp.id === selectedSubPortId}
          domainColor={getDomainColor(sp.clockDomainIdx)}
          onRename={onSubPortRename}
          annotations={annotations[sp.id]}
          dimmed={
            matchedIds !== null &&
            !matchedIds.subPortIds.has(sp.id) &&
            !matchedIds.portIds.has(sp.parentBusId)
          }
          highlighted={matchedIds?.subPortIds.has(sp.id) ?? false}
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
  );
};

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

function renderEdgeBadge(
  ports: LayoutPort[],
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
