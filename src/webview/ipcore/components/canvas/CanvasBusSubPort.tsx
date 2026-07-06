import React, { useState, useRef, useCallback } from 'react';
import type { LayoutSubPort } from './canvasLayout';
import { STUB_LENGTH } from './canvasLayout';
import { DirectionArrow } from './CanvasPort';
import type { ValidationAnnotation } from '../../hooks/useCanvasValidation';

interface CanvasBusSubPortProps {
  subPort: LayoutSubPort;
  onActivate: (subPortId: string) => void;
  onDeactivate: (subPortId: string) => void;
  onSelect: (busId: string) => void;
  /** Marks this specific signal as the selected one (for the ring + Delete-key target) */
  onSelectSignal?: (subPortId: string) => void;
  /** True when this signal is the one last selected (drives the selection ring) */
  isSelected?: boolean;
  domainColor?: string;
  onRename?: (subPortId: string, newSuffix: string) => void;
  annotations?: ValidationAnnotation[];
  /** True when a port search is active and this sub-port does not match */
  dimmed?: boolean;
  /** True when a port search is active and this sub-port's signal name matched */
  highlighted?: boolean;
}

const RENAME_INPUT_W = 120;
const RENAME_INPUT_H = 14;

/**
 * Renders a single signal stub for an expanded bus interface.
 *
 * Logical signal name (e.g. AWADDR[31:0]) is shown inside the block.
 * Physical port name (e.g. s_axi_awaddr[31:0]) is shown on the external stub.
 *
 * Required and active-optional ports show a solid stub.
 * Inactive optional ports show a dashed stub.
 * A single click only selects the signal (parent bus interface opens in the
 * inspector, and this row gets the selection ring) — it never changes the
 * port's active state, so inspecting a signal is always safe.
 * Double-clicking an optional port activates/deactivates it. The selected
 * signal can also be deactivated by pressing Delete (handled by the app-level
 * keyboard shortcut, gated on the selection this component reports).
 * Right-clicking an active port starts inline renaming of its physical suffix.
 */
export const CanvasBusSubPort: React.FC<CanvasBusSubPortProps> = ({
  subPort,
  onActivate,
  onDeactivate,
  onSelect,
  onSelectSignal,
  isSelected = false,
  domainColor,
  onRename,
  annotations,
  dimmed = false,
  highlighted = false,
}) => {
  const isLeft = subPort.side === 'left';
  const stubDir = isLeft ? -1 : 1;
  const stubEndX = subPort.x + stubDir * STUB_LENGTH;

  const hasError = annotations?.some((a) => a.severity === 'error') ?? false;
  const tooltipText = annotations
    ?.map((a) => `[${a.severity.toUpperCase()}] ${a.message}`)
    .join('\n');

  const isAbsent = subPort.absent === true;
  const isOptional = subPort.presence === 'optional';
  const isInactive = isOptional && !subPort.active;

  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const abortRef = useRef(false);

  // Logical label shown inside the block (signal role within the bus protocol)
  const logicalLabel = subPort.widthLabel ? `${subPort.name}${subPort.widthLabel}` : subPort.name;

  // Physical label shown outside on the stub (actual HDL port name)
  const currentSuffix = subPort.physicalSuffix ?? subPort.name.toLowerCase();
  const physicalName = `${subPort.physicalPrefix}${currentSuffix}`;
  const physicalLabel = subPort.widthLabel ? `${physicalName}${subPort.widthLabel}` : physicalName;

  const commitRename = useCallback(() => {
    if (abortRef.current) {
      return;
    }
    onRename?.(subPort.id, renameValue);
    setIsRenaming(false);
  }, [onRename, subPort.id, renameValue]);

  // A single click only selects — it never toggles the active state.
  const handleClick = (e: React.MouseEvent) => {
    if (isRenaming) {
      return;
    }
    e.stopPropagation();
    onSelect(subPort.parentBusId);
    onSelectSignal?.(subPort.id);
  };

  // Double-click toggles an optional port's active state.
  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isRenaming || isAbsent) {
      return;
    }
    e.stopPropagation();
    if (isInactive) {
      onActivate(subPort.id);
    } else if (isOptional && subPort.active) {
      onDeactivate(subPort.id);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onRename || isInactive || isAbsent) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    abortRef.current = false;
    setRenameValue(currentSuffix);
    setIsRenaming(true);
  };

  // foreignObject x position: right-aligned for left ports, left-aligned for right ports
  const foX = isLeft ? stubEndX - 5 - RENAME_INPUT_W : stubEndX + 5;
  const foY = subPort.y - RENAME_INPUT_H / 2;

  return (
    <g
      className={`canvas-bus-subport ${isAbsent ? 'canvas-bus-subport--absent' : isInactive ? 'canvas-bus-subport--inactive' : 'canvas-bus-subport--active'} ${isOptional ? 'canvas-bus-subport--optional' : ''} ${dimmed ? 'canvas-bus-subport--dimmed' : ''} ${highlighted ? 'canvas-bus-subport--highlighted' : ''} ${isSelected ? 'canvas-bus-subport--selected' : ''}`}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      style={{ cursor: isRenaming ? 'default' : 'pointer' }}
      role="button"
    >
      {/* Stub line */}
      <line
        x1={subPort.x}
        y1={subPort.y}
        x2={stubEndX}
        y2={subPort.y}
        className="canvas-bus-subport__line"
        strokeDasharray={isInactive || isAbsent ? '4 3' : undefined}
        style={domainColor && !isAbsent ? { stroke: domainColor } : undefined}
      />

      {/* Tiny dot at block edge */}
      <circle
        cx={subPort.x}
        cy={subPort.y}
        r={2}
        className="canvas-bus-subport__dot"
        style={domainColor ? { fill: domainColor } : undefined}
      />

      {/* Direction arrow at stub midpoint */}
      {subPort.direction && (
        <DirectionArrow
          x={subPort.x + stubDir * (STUB_LENGTH / 2)}
          y={subPort.y}
          side={subPort.side}
          direction={subPort.direction}
          color={domainColor}
        />
      )}

      {/* Logical name — inside the block */}
      <text
        x={subPort.x + (isLeft ? 8 : -8)}
        y={subPort.y}
        textAnchor={isLeft ? 'start' : 'end'}
        dominantBaseline="central"
        className="canvas-bus-subport__logical"
        style={domainColor ? { fill: domainColor } : undefined}
      >
        {logicalLabel}
      </text>

      {/* Physical port name — outside on the stub; hidden while renaming */}
      {!isRenaming && (
        <text
          x={stubEndX + stubDir * 5}
          y={subPort.y}
          textAnchor={isLeft ? 'end' : 'start'}
          dominantBaseline="central"
          className="canvas-bus-subport__label"
        >
          {physicalLabel}
        </text>
      )}

      {/* Inline rename input — replaces the physical label while editing */}
      {isRenaming && (
        <foreignObject
          x={foX}
          y={foY}
          width={RENAME_INPUT_W}
          height={RENAME_INPUT_H}
          style={{ overflow: 'visible' }}
        >
          <input
            className="canvas-bus-subport__rename-input"
            style={{ textAlign: isLeft ? 'right' : 'left' }}
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
      )}

      {/* "!" badge for absent required ports — required by spec but missing from source */}
      {isAbsent && (
        <g>
          <text
            x={subPort.x + stubDir * (STUB_LENGTH / 2)}
            y={subPort.y - 9}
            textAnchor="middle"
            dominantBaseline="central"
            className="canvas-bus-subport__absent-hint"
          >
            !
          </text>
          <title>
            Required by bus spec but absent from HDL source — not included in generated output
          </title>
        </g>
      )}

      {/* "+" badge for inactive optional ports — hint to double-click to activate */}
      {isInactive && (
        <g>
          <text
            x={subPort.x + stubDir * (STUB_LENGTH / 2)}
            y={subPort.y - 9}
            textAnchor="middle"
            dominantBaseline="central"
            className="canvas-bus-subport__activate-hint"
          >
            +
          </text>
          <title>Double-click to activate this optional signal</title>
        </g>
      )}

      {/* "×" badge for active optional ports — hint to double-click to deactivate */}
      {isOptional && subPort.active && (
        <g>
          <text
            x={subPort.x + stubDir * (STUB_LENGTH / 2)}
            y={subPort.y - 9}
            textAnchor="middle"
            dominantBaseline="central"
            className="canvas-bus-subport__deactivate-hint"
          >
            ×
          </text>
          <title>
            Double-click, or select and press Delete, to deactivate this optional signal
          </title>
        </g>
      )}

      {/* Validation error dot — mirrors CanvasPort behaviour */}
      {hasError && (
        <circle
          cx={stubEndX + stubDir * 5}
          cy={subPort.y - 8}
          r={4}
          className="ip-canvas-annotation-dot ip-canvas-annotation-dot--error"
          style={{ pointerEvents: 'none' }}
        >
          <title>{tooltipText}</title>
        </circle>
      )}
    </g>
  );
};
