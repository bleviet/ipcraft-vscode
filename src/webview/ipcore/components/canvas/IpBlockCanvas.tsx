import React, { useMemo, useState, useCallback, useEffect } from 'react';
import type { IpCore } from '../../../types/ipCore';
import { computeLayout } from './canvasLayout';
import { CanvasPort } from './CanvasPort';
import { CanvasBusBundle } from './CanvasBusBundle';
import { RemoveZone } from './RemoveZone';
import { useCanvasValidation } from '../../hooks/useCanvasValidation';
import './canvas.css';

interface IpBlockCanvasProps {
  ipCore: IpCore;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Drag-over handler from useCanvasDrop (Phase 3) */
  onDragOver?: (e: React.DragEvent) => void;
  /** Drop handler from useCanvasDrop (Phase 3) */
  onDrop?: (e: React.DragEvent) => void;
  /** Remove handler when a port is dropped to delete (Phase 4) */
  onRemove?: (kind: string, id: string) => void;
}

/**
 * Main canvas component rendering the IP core as an SVG schematic block.
 *
 * The block body sits at center with ports arranged along left, right, and bottom edges.
 * Bus interfaces render as wide "bundle" connectors; clocks/resets/ports as thin stubs.
 */
export const IpBlockCanvas: React.FC<IpBlockCanvasProps> = ({
  ipCore,
  selectedId,
  onSelect,
  onDragOver,
  onDrop,
  onRemove,
}) => {
  const layout = useMemo(() => computeLayout(ipCore), [ipCore]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [blockHovered, setBlockHovered] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [dragOutActive, setDragOutActive] = useState(false);

  const annotations = useCanvasValidation(ipCore);

  const handleBackgroundClick = useCallback(() => {
    onSelect(null);
  }, [onSelect]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input or textarea
      const activeTag = document.activeElement?.tagName.toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') {
        return;
      }

      if (e.key === 'Escape') {
        onSelect(null);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && onRemove) {
        // Parse kind and id from selectedId e.g. "port:1"
        const [kind, id] = selectedId.split(':');
        if (kind && id) {
          onRemove(kind, id);
          onSelect(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, onSelect, onRemove]);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      // Check if this is a drag-to-remove from our own ports
      if (e.dataTransfer.types.includes('application/x-ipcraft-remove')) {
        e.preventDefault();
        setDragOutActive(true);
        return;
      }

      setDragActive(true);
      onDragOver?.(e);
    },
    [onDragOver]
  );

  const handleDragLeave = useCallback(() => {
    setDragActive(false);
    setDragOutActive(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setDragActive(false);
      setDragOutActive(false);

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
    viewBox,
    coreName,
    vlnvLabel,
    parameters,
    paramSeparatorY,
    portSeparatorY,
  } = layout;

  return (
    <div
      className={`ip-canvas-container ${dragActive ? 'ip-canvas-container--drag-active' : ''}`}
      onDragEnd={() => setDragOutActive(false)}
    >
      <RemoveZone visible={dragOutActive} />
      <svg
        className="ip-canvas-svg"
        viewBox={`0 0 ${viewBox.width} ${viewBox.height}`}
        preserveAspectRatio="xMidYMid meet"
        onClick={handleBackgroundClick}
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
        <rect width="100%" height="100%" fill="url(#canvas-grid)" />

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

        {/* Second separator — below generics, above where port stubs connect */}
        {parameters.length > 0 && (
          <line
            x1={blockRect.x + 8}
            y1={portSeparatorY}
            x2={blockRect.x + blockRect.width - 8}
            y2={portSeparatorY}
            className="ip-block-param-separator"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Description (if present) */}
        {ipCore.description && (
          <text
            x={blockRect.x + blockRect.width / 2}
            y={blockRect.y + blockRect.height - 14}
            textAnchor="middle"
            dominantBaseline="central"
            className="ip-block-description"
            style={{ pointerEvents: 'none' }}
          >
            {ipCore.description.length > 40
              ? ipCore.description.slice(0, 37) + '...'
              : ipCore.description}
          </text>
        )}

        {/* Port stubs */}
        {ports.map((p) => {
          const isSelected = selectedId === p.id;
          const isHovered = hoveredId === p.id;

          if (p.kind === 'bus') {
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
                  onSelect={onSelect}
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
                annotations={annotations[p.id]}
                onSelect={onSelect}
              />
            </g>
          );
        })}

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
    </div>
  );
};

// --- Helper sub-components ---

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
