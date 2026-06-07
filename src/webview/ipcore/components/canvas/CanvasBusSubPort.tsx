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
 * Inactive optional ports show a dashed stub and are clickable to activate.
 * Clicking any signal selects the parent bus interface in the inspector.
 * Right-clicking an active port starts inline renaming of its physical suffix.
 */
export const CanvasBusSubPort: React.FC<CanvasBusSubPortProps> = ({
  subPort,
  onActivate,
  onDeactivate,
  onSelect,
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

  const handleClick = (e: React.MouseEvent) => {
    if (isRenaming) {
      return;
    }
    e.stopPropagation();
    onSelect(subPort.parentBusId);
    if (isInactive) {
      onActivate(subPort.id);
    } else if (isOptional && subPort.active) {
      onDeactivate(subPort.id);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onRename || isInactive) {
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
      className={`canvas-bus-subport ${isInactive ? 'canvas-bus-subport--inactive' : 'canvas-bus-subport--active'} ${isOptional ? 'canvas-bus-subport--optional' : ''} ${dimmed ? 'canvas-bus-subport--dimmed' : ''} ${highlighted ? 'canvas-bus-subport--highlighted' : ''}`}
      onClick={handleClick}
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
        strokeDasharray={isInactive ? '4 3' : undefined}
        style={domainColor ? { stroke: domainColor } : undefined}
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

      {/* "+" badge for inactive optional ports — hint to activate */}
      {isInactive && (
        <text
          x={subPort.x + stubDir * (STUB_LENGTH / 2)}
          y={subPort.y - 9}
          textAnchor="middle"
          dominantBaseline="central"
          className="canvas-bus-subport__activate-hint"
        >
          +
        </text>
      )}

      {/* "×" badge for active optional ports — hint to deactivate */}
      {isOptional && subPort.active && (
        <text
          x={subPort.x + stubDir * (STUB_LENGTH / 2)}
          y={subPort.y - 9}
          textAnchor="middle"
          dominantBaseline="central"
          className="canvas-bus-subport__deactivate-hint"
        >
          ×
        </text>
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
