import React, { useState, useRef, useCallback } from 'react';
import type { LayoutPort } from './canvasLayout';
import { STUB_LENGTH } from './canvasLayout';

import { ValidationAnnotation } from '../../hooks/useCanvasValidation';

interface CanvasBusBundleProps {
  port: LayoutPort;
  selected: boolean;
  annotations?: ValidationAnnotation[];
  onSelect: (id: string) => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  domainColor?: string;
  onMemoryMapClick?: () => void;
  /** Called when a port stub is dragged and dropped onto this bus bundle */
  onPortDrop?: (portIndex: number) => void;
  /** True while a port is being pointer-dragged and the cursor is over this bundle */
  isPortDropTarget?: boolean;
  onRename?: (busId: string, newName: string) => void;
}

const RENAME_INPUT_W = 100;
const RENAME_INPUT_H = 14;

/**
 * Renders a bus interface as a wide "bundle" connector on the block edge.
 *
 * Visually distinct from regular ports: thicker stub, protocol badge, mode indicator.
 * Supports expand/collapse to show individual bus port signals.
 */
const PORT_MOVE_MIME = 'application/x-ipcraft-port-move';

export const CanvasBusBundle: React.FC<CanvasBusBundleProps> = ({
  port,
  selected,
  annotations,
  onSelect,
  isExpanded = false,
  onToggleExpand,
  domainColor,
  onMemoryMapClick,
  onPortDrop,
  isPortDropTarget = false,
  onRename,
}) => {
  const [isDragTarget, setIsDragTarget] = useState(false);
  // Counter tracks nested dragenter/dragleave pairs so crossing child-element
  // boundaries doesn't toggle the highlight off prematurely.
  const dragEnterCountRef = useRef(0);
  const isLeft = port.side === 'left';

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const abortRef = useRef(false);

  const commitRename = useCallback(() => {
    if (abortRef.current) {
      return;
    }
    onRename?.(port.id, renameValue);
    setIsRenaming(false);
  }, [onRename, port.id, renameValue]);

  const hasError = annotations?.some((a) => a.severity === 'error');
  const hasWarning = annotations?.some((a) => a.severity === 'warning') ?? false;
  const warningMessages =
    annotations?.filter((a) => a.severity === 'warning').map((a) => a.message) ?? [];
  const tooltipText = annotations
    ?.map((a) => `[${a.severity.toUpperCase()}] ${a.message}`)
    .join('\n');

  // Sub-badge rows below the name: mmap ref and/or warning badge
  const subBadgeCount = (port.memoryMapRef ? 1 : 0) + (hasWarning ? 1 : 0);
  const nameYOffset = subBadgeCount >= 1 ? -5 : 0;
  // Warning badge sits in the second slot when mmap is present, first slot otherwise
  const warnBadgeY = port.y + (port.memoryMapRef ? 19 : 7);

  // Bundle stub geometry (thicker "bus" line)
  const stubDir = isLeft ? -1 : 1;
  const stubEndX = port.x + stubDir * STUB_LENGTH;

  // Toggle sits right at the stub tip (small gap from the stub end)
  const TOGGLE_W = 16;
  const TOGGLE_GAP = 4; // gap between stub tip and toggle button
  const toggleX = stubEndX + stubDir * TOGGLE_GAP;
  const toggleY = port.y;

  // Badge sits past the toggle (when toggle exists) so the two never overlap.
  // Without toggle: small gap from stub end; with toggle: clear the toggle first.
  const badgeGap = onToggleExpand ? TOGGLE_GAP + TOGGLE_W + 4 : 8;
  const badgeX = stubEndX + stubDir * badgeGap;
  const badgeY = port.y;

  return (
    <g
      className={`canvas-bus-bundle ${selected ? 'canvas-bus-bundle--selected' : ''} ${isExpanded ? 'canvas-bus-bundle--expanded' : ''} ${isDragTarget || isPortDropTarget ? 'canvas-bus-bundle--drop-target' : ''}`}
      onClick={(e) => {
        if (isRenaming) {
          return;
        }
        e.stopPropagation();
        onSelect(port.id);
      }}
      onContextMenu={(e) => {
        if (!onRename) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        abortRef.current = false;
        setRenameValue(port.label);
        setIsRenaming(true);
      }}
      data-port-id={port.id}
      ref={(el) => el?.setAttribute('draggable', 'true')}
      style={{ cursor: isRenaming ? 'default' : 'grab' }}
      onDragStart={(e) => {
        e.stopPropagation();
        const payload = { action: 'remove', kind: port.kind, id: port.id };
        e.dataTransfer.setData('application/x-ipcraft-remove', JSON.stringify(payload));
        e.dataTransfer.effectAllowed = 'move';

        const target = e.currentTarget as SVGGElement;
        setTimeout(() => {
          target.style.opacity = '0.4';
        }, 0);
      }}
      onDragEnd={(e) => {
        const target = e.currentTarget as SVGGElement;
        target.style.opacity = '1';
        dragEnterCountRef.current = 0;
        setIsDragTarget(false);
      }}
      onDragEnter={(e) => {
        if (onPortDrop && e.dataTransfer.types.includes(PORT_MOVE_MIME)) {
          e.preventDefault();
          dragEnterCountRef.current++;
          setIsDragTarget(true);
        }
      }}
      onDragLeave={() => {
        dragEnterCountRef.current = Math.max(0, dragEnterCountRef.current - 1);
        if (dragEnterCountRef.current === 0) {
          setIsDragTarget(false);
        }
      }}
      onDragOver={(e) => {
        if (onPortDrop && e.dataTransfer.types.includes(PORT_MOVE_MIME)) {
          e.preventDefault();
          e.stopPropagation();
          e.dataTransfer.dropEffect = 'move';
        }
      }}
      onDrop={(e) => {
        dragEnterCountRef.current = 0;
        setIsDragTarget(false);
        if (!onPortDrop) {
          return;
        }
        const raw = e.dataTransfer.getData(PORT_MOVE_MIME);
        if (!raw) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        try {
          const payload = JSON.parse(raw) as { portIndex: number };
          if (typeof payload.portIndex === 'number') {
            onPortDrop(payload.portIndex);
          }
        } catch {
          // ignore malformed payload
        }
      }}
    >
      {/* Hit area */}
      <rect
        x={isLeft ? stubEndX : port.x}
        y={port.y - 12}
        width={STUB_LENGTH}
        height={24}
        fill="transparent"
        style={{ cursor: 'pointer' }}
      />

      {/* Drop-target highlight (shown when a port is dragged over this bundle) */}
      {isDragTarget && (
        <rect
          x={isLeft ? stubEndX - 4 : port.x - 4}
          y={port.y - 14}
          width={STUB_LENGTH + 8}
          height={28}
          rx={4}
          fill="none"
          stroke="var(--vscode-focusBorder)"
          strokeWidth={2}
          strokeDasharray="4 3"
          style={{ pointerEvents: 'none' }}
        />
      )}

      {/* Bus stub (thick line) */}
      <line
        x1={port.x}
        y1={port.y}
        x2={stubEndX}
        y2={port.y}
        className="canvas-bus-bundle__stub"
        strokeWidth={4}
        style={domainColor ? { stroke: domainColor } : undefined}
      />

      {/* Connector block at block edge */}
      <rect
        x={port.x - 4}
        y={port.y - 6}
        width={8}
        height={12}
        className="canvas-bus-bundle__connector"
        rx={2}
        style={domainColor ? { fill: domainColor } : undefined}
      />

      {/* Protocol badge */}
      <g transform={`translate(${badgeX}, ${badgeY})`}>
        <rect
          x={isLeft ? -80 : 0}
          y={-10}
          width={80}
          height={20}
          rx={4}
          className="canvas-bus-bundle__badge"
          style={domainColor ? { stroke: domainColor } : undefined}
        />
        <text
          x={isLeft ? -40 : 40}
          y={0}
          textAnchor="middle"
          dominantBaseline="central"
          className="canvas-bus-bundle__protocol"
        >
          {port.protocol ?? 'Bus'}
        </text>
        {/* Array count overlay — top-right corner of the badge */}
        {(port.arrayCount ?? 0) > 1 && (
          <g>
            <rect
              x={isLeft ? -13 : 67}
              y={-20}
              width={22}
              height={14}
              rx={4}
              className="canvas-bus-bundle__array-badge"
            />
            <text
              x={isLeft ? -2 : 78}
              y={-13}
              textAnchor="middle"
              dominantBaseline="central"
              className="canvas-bus-bundle__array-badge-text"
            >
              ×{port.arrayCount}
            </text>
          </g>
        )}
      </g>

      {/* Mode indicator (S/M/Src/Sink) */}
      {port.mode && (
        <g transform={`translate(${port.x + stubDir * (STUB_LENGTH / 2)}, ${port.y - 12})`}>
          <rect x={-14} y={-8} width={28} height={16} rx={3} className="canvas-bus-bundle__mode" />
          <text
            x={0}
            y={0}
            textAnchor="middle"
            dominantBaseline="central"
            className="canvas-bus-bundle__mode-text"
            fontSize={9}
            fontWeight={700}
          >
            {port.mode}
          </text>
        </g>
      )}

      {/* Name label (INSIDE the block) — hidden while renaming */}
      {!isRenaming && (
        <text
          x={port.x + (isLeft ? 12 : -12)}
          y={port.y + nameYOffset}
          textAnchor={isLeft ? 'start' : 'end'}
          dominantBaseline="central"
          className="canvas-bus-bundle__name"
        >
          {port.label}
        </text>
      )}

      {/* Memory map ref badge (INSIDE the block, below the name) */}
      {port.memoryMapRef && (
        <g
          transform={`translate(${port.x + (isLeft ? 14 : -14)}, ${port.y + 7})`}
          onClick={
            onMemoryMapClick
              ? (e) => {
                  e.stopPropagation();
                  onMemoryMapClick();
                }
              : undefined
          }
          style={onMemoryMapClick ? { cursor: 'pointer' } : undefined}
        >
          <rect
            x={isLeft ? 0 : -60}
            y={-6}
            width={60}
            height={12}
            rx={3}
            className="canvas-bus-bundle__mmap-badge"
          />
          <text
            x={isLeft ? 30 : -30}
            y={0}
            textAnchor="middle"
            dominantBaseline="central"
            className="canvas-bus-bundle__mmap-text"
          >
            {port.memoryMapRef.length > 10
              ? port.memoryMapRef.slice(0, 9) + '…'
              : port.memoryMapRef}
          </text>
        </g>
      )}

      {/* Warning badge (INSIDE the block, below the name / mmap badge) */}
      {hasWarning && (
        <g transform={`translate(${port.x + (isLeft ? 14 : -14)}, ${warnBadgeY})`}>
          <rect
            x={isLeft ? 0 : -60}
            y={-6}
            width={60}
            height={12}
            rx={3}
            className="canvas-bus-bundle__warn-badge"
          />
          <text
            x={isLeft ? 30 : -30}
            y={0}
            textAnchor="middle"
            dominantBaseline="central"
            className="canvas-bus-bundle__warn-text"
          >
            ⚠ {warningMessages[0]?.includes('physicalPrefix') ? 'dup. prefix' : 'warning'}
          </text>
          <title>{warningMessages.join('\n')}</title>
        </g>
      )}

      {/* Expand/collapse toggle — at the stub tip */}
      {onToggleExpand && (
        <g
          transform={`translate(${toggleX}, ${toggleY})`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          style={{ cursor: 'pointer' }}
          className="canvas-bus-bundle__expand-toggle"
        >
          <rect
            x={isLeft ? -TOGGLE_W : 0}
            y={-8}
            width={TOGGLE_W}
            height={16}
            rx={3}
            className="canvas-bus-bundle__expand-bg"
          />
          <text
            x={isLeft ? -(TOGGLE_W / 2) : TOGGLE_W / 2}
            y={0}
            textAnchor="middle"
            dominantBaseline="central"
            className="canvas-bus-bundle__expand-icon"
            fontSize={9}
          >
            {isExpanded ? '▲' : '▼'}
          </text>
        </g>
      )}

      {/* Selection ring */}
      {selected && (
        <rect
          x={Math.min(port.x, stubEndX) - 4}
          y={port.y - 16}
          width={STUB_LENGTH + 8}
          height={32}
          rx={6}
          className="canvas-bus-bundle__selection-ring"
        />
      )}

      {/* Error indicator dot — shown only for errors (warnings use the inline badge above) */}
      {hasError && (
        <circle
          cx={port.x + stubDir * (STUB_LENGTH / 2)}
          cy={port.y - 20}
          r={5}
          className="ip-canvas-annotation-dot ip-canvas-annotation-dot--error"
        >
          <title>{tooltipText}</title>
        </circle>
      )}

      {/* Inline rename input — rendered last so it paints above badges */}
      {isRenaming &&
        (() => {
          const nameX = port.x + (isLeft ? 12 : -12);
          const nameY = port.y + nameYOffset;
          const foX = isLeft ? nameX : nameX - RENAME_INPUT_W;
          return (
            <foreignObject
              x={foX}
              y={nameY - RENAME_INPUT_H / 2}
              width={RENAME_INPUT_W}
              height={RENAME_INPUT_H}
            >
              <input
                className="canvas-bus-subport__rename-input"
                style={{ textAlign: isLeft ? 'left' : 'right' }}
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === 'Escape') {
                    abortRef.current = true;
                    setIsRenaming(false);
                  }
                }}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              />
            </foreignObject>
          );
        })()}
    </g>
  );
};
