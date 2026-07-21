import React, { useState, useRef, useCallback } from 'react';
import type { LayoutPort, PortSide } from './canvasLayout';
import { STUB_LENGTH } from './canvasLayout';

import { ValidationAnnotation } from '../../hooks/useCanvasValidation';

interface CanvasPortProps {
  port: LayoutPort;
  selected: boolean;
  inMultiSelection?: boolean;
  annotations?: ValidationAnnotation[];
  onSelect: (id: string) => void;
  onShiftSelect?: (id: string) => void;
  domainColor?: string;
  /** Called when the user begins dragging this port toward a bus bundle */
  onPortDragStart?: (portIndex: number, clientX: number, clientY: number) => void;
  /** True while this specific port is being dragged */
  isDragging?: boolean;
  onRename?: (portId: string, newName: string) => void;
  /** True when a port search is active and this port does not match */
  dimmed?: boolean;
}

const RENAME_INPUT_W = 100;
const RENAME_INPUT_H = 14;
const POLARITY_BADGE_OFFSET = 13;

/**
 * Renders a single port stub on the IP block edge.
 *
 * Left-side ports: stub extends leftward, label to the left.
 * Right-side ports: stub extends rightward, label to the right.
 * Bottom ports: stub extends downward, label below.
 */
export const CanvasPort: React.FC<CanvasPortProps> = ({
  port,
  selected,
  inMultiSelection = false,
  annotations,
  onSelect,
  onShiftSelect,
  domainColor,
  onPortDragStart,
  isDragging = false,
  onRename,
  dimmed = false,
}) => {
  const isLeft = port.side === 'left';
  const isRight = port.side === 'right';
  const isBottom = port.side === 'bottom';
  const resetPolarity = port.kind === 'reset' ? (port.polarity ?? 'activeHigh') : undefined;
  const isActiveLowReset = resetPolarity === 'activeLow';
  const resetDescription = isActiveLowReset ? 'Active-low reset' : 'Active-high reset';

  const hasError = annotations?.some((a) => a.severity === 'error');
  const tooltipText = annotations
    ?.map((a) => `[${a.severity.toUpperCase()}] ${a.message}`)
    .join('\n');

  // Stub line geometry
  let x1: number, y1: number, x2: number, y2: number;
  if (isLeft) {
    x1 = port.x;
    y1 = port.y;
    x2 = port.x - STUB_LENGTH;
    y2 = port.y;
  } else if (isRight) {
    x1 = port.x;
    y1 = port.y;
    x2 = port.x + STUB_LENGTH;
    y2 = port.y;
  } else {
    // bottom
    x1 = port.x;
    y1 = port.y;
    x2 = port.x;
    y2 = port.y + STUB_LENGTH;
  }

  // Label position
  let labelX: number, labelY: number;
  let textAnchor: string;
  if (isLeft) {
    labelX = port.x - STUB_LENGTH - 6;
    labelY = port.y;
    textAnchor = 'end';
  } else if (isRight) {
    labelX = port.x + STUB_LENGTH + 6;
    labelY = port.y;
    textAnchor = 'start';
  } else {
    labelX = port.x;
    labelY = port.y + STUB_LENGTH + 14;
    textAnchor = 'middle';
  }

  // Width annotation position
  let widthX: number, widthY: number;
  if (isLeft) {
    widthX = port.x - STUB_LENGTH / 2;
    widthY = port.y - 10;
  } else if (isRight) {
    widthX = port.x + STUB_LENGTH / 2;
    widthY = port.y - 10;
  } else {
    widthX = port.x + 12;
    widthY = port.y + STUB_LENGTH / 2;
  }

  // Direction arrow midpoint
  const arrowMidX = isLeft ? port.x - STUB_LENGTH / 2 : isRight ? port.x + STUB_LENGTH / 2 : port.x;
  const arrowMidY = isBottom ? port.y + STUB_LENGTH / 2 : port.y;

  // Connector dot radius
  const dotR = port.kind === 'bus' ? 5 : 3;

  // Inline rename state
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

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!onRename) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    abortRef.current = false;
    setRenameValue(port.label);
    setIsRenaming(true);
  };

  // foreignObject position — sits where the label text is
  let foX: number, foY: number, foTextAlign: 'left' | 'right' | 'center';
  if (isLeft) {
    foX = labelX - RENAME_INPUT_W;
    foY = labelY - RENAME_INPUT_H / 2;
    foTextAlign = 'right';
  } else if (isRight) {
    foX = labelX;
    foY = labelY - RENAME_INPUT_H / 2;
    foTextAlign = 'left';
  } else {
    foX = labelX - RENAME_INPUT_W / 2;
    foY = labelY - RENAME_INPUT_H / 2;
    foTextAlign = 'center';
  }

  return (
    <g
      className={`canvas-port canvas-port--${port.kind} ${selected ? 'canvas-port--selected' : ''} ${inMultiSelection ? 'canvas-port--multi-selected' : ''} ${dimmed ? 'canvas-port--dimmed' : ''}`}
      onClick={(e) => {
        if (isRenaming) {
          return;
        }
        e.stopPropagation();
        if (e.shiftKey && onShiftSelect) {
          onShiftSelect(port.id);
        } else {
          onSelect(port.id);
        }
      }}
      data-port-id={port.id}
      data-reset-polarity={resetPolarity}
      aria-label={resetPolarity ? `${port.label}: ${resetDescription.toLowerCase()}` : undefined}
      style={{ cursor: isRenaming ? 'default' : 'pointer', opacity: isDragging ? 0.4 : undefined }}
      onContextMenu={handleContextMenu}
      onPointerDown={(e) => {
        if (e.button !== 0 || !onPortDragStart) {
          return;
        }
        e.stopPropagation();
        const portIndex = parseInt(port.id.split(':')[1] ?? '-1', 10);
        if (portIndex >= 0) {
          onPortDragStart(portIndex, e.clientX, e.clientY);
        }
      }}
    >
      {resetPolarity && <title>{`${port.label}: ${resetDescription}`}</title>}

      {/* Hit area (invisible, wider for easier clicking) */}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="transparent"
        strokeWidth={16}
        style={{ cursor: 'pointer' }}
      />

      {/* Stub line */}
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        className="canvas-port__stub"
        strokeWidth={port.kind === 'bus' ? 3 : 1.5}
        style={domainColor ? { stroke: domainColor } : undefined}
      />

      {/* Connector dot at block edge */}
      {isActiveLowReset ? (
        <circle
          cx={port.x}
          cy={port.y}
          r={4}
          className="canvas-port__dot canvas-port__inversion-bubble"
          style={domainColor ? { stroke: domainColor } : undefined}
        />
      ) : (
        <circle
          cx={port.x}
          cy={port.y}
          r={dotR}
          className="canvas-port__dot"
          style={domainColor ? { fill: domainColor } : undefined}
        />
      )}

      {/* Direction arrow */}
      {port.direction && (
        <DirectionArrow
          x={arrowMidX}
          y={arrowMidY}
          side={port.side}
          direction={port.direction}
          color={domainColor}
        />
      )}

      {/* Port kind icon (clock/reset/interrupt) — placed inside the block body */}
      {(port.kind === 'clock' || port.kind === 'reset' || port.kind === 'interrupt') && (
        <PortKindIcon
          kind={port.kind}
          x={isLeft ? port.x + 14 : isRight ? port.x - 14 : port.x}
          y={isBottom ? port.y - 14 : port.y}
          color={domainColor}
          polarity={resetPolarity}
          side={port.side}
        />
      )}

      {/* Port label — hidden while renaming */}
      {!isRenaming && (
        <text
          x={labelX}
          y={labelY}
          textAnchor={textAnchor}
          dominantBaseline="central"
          className="canvas-port__label"
        >
          {port.label}
        </text>
      )}

      {/* Inline rename input */}
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
            style={{ textAlign: foTextAlign }}
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

      {/* Width annotation */}
      {port.widthLabel && (
        <text x={widthX} y={widthY} textAnchor="middle" className="canvas-port__width">
          {port.widthLabel}
        </text>
      )}

      {/* Selection ring */}
      {selected && (
        <circle cx={port.x} cy={port.y} r={10} className="canvas-port__selection-ring" />
      )}

      {/* Multi-selection ring — shown whenever the port is in the selection group */}
      {inMultiSelection && (
        <circle cx={port.x} cy={port.y} r={10} className="canvas-port__multi-selection-ring" />
      )}

      {/* Validation Indicator */}
      {annotations && annotations.length > 0 && (
        <circle
          cx={isLeft ? x2 - 8 : isRight ? x2 + 8 : x2}
          cy={isBottom ? y2 + 8 : port.y - 8}
          r={4}
          className={`ip-canvas-annotation-dot ${hasError ? 'ip-canvas-annotation-dot--error' : 'ip-canvas-annotation-dot--warning'}`}
        >
          <title>{tooltipText}</title>
        </circle>
      )}
    </g>
  );
};

const PortKindIcon: React.FC<{
  kind: string;
  x: number;
  y: number;
  color?: string;
  polarity?: 'activeHigh' | 'activeLow';
  side: PortSide;
}> = ({ kind, x, y, color, polarity, side }) => {
  const s = color ? { stroke: color } : undefined;
  const f = color ? { fill: color } : undefined;

  if (kind === 'clock') {
    return (
      <g transform={`translate(${x}, ${y})`} className="canvas-port__icon">
        {/* Watch face */}
        <circle cx={0} cy={0} r={5} className="canvas-port__icon-face" />
        {/* Hour hand ~10 o'clock */}
        <line x1={0} y1={0} x2={-2} y2={-3} className="canvas-port__icon-hand" style={s} />
        {/* Minute hand pointing 12 */}
        <line x1={0} y1={0} x2={0} y2={-4} className="canvas-port__icon-hand" style={s} />
      </g>
    );
  }

  if (kind === 'reset') {
    const badgeX = side === 'right' ? -POLARITY_BADGE_OFFSET : POLARITY_BADGE_OFFSET;
    return (
      <g transform={`translate(${x}, ${y})`} className="canvas-port__icon">
        {/* ~270\u00b0 clockwise arc */}
        <path d="M 0 -4.5 A 4.5 4.5 0 1 1 -4.5 0" className="canvas-port__icon-arc" style={s} />
        {/* Arrowhead at arc end pointing downward */}
        <polygon points="-4.5,0 -6.5,-2 -2.5,-2" className="canvas-port__icon-arrow" style={f} />
        <g
          transform={`translate(${badgeX}, 0)`}
          className={`canvas-port__polarity-badge canvas-port__polarity-badge--${polarity === 'activeLow' ? 'low' : 'high'}`}
        >
          <rect x={-5} y={-5} width={10} height={10} rx={3} />
          <text x={0} y={0} textAnchor="middle" dominantBaseline="central">
            {polarity === 'activeLow' ? 'L' : 'H'}
          </text>
        </g>
      </g>
    );
  }

  if (kind === 'interrupt') {
    return (
      <g
        transform={`translate(${x}, ${y})`}
        className="canvas-port__icon canvas-port__icon--interrupt"
      >
        {/* Lightning bolt */}
        <polygon points="1,-5 -2,0 1,0 -1,5 2,0 -1,0" style={f} />
      </g>
    );
  }

  return null;
};

export const DirectionArrow: React.FC<{
  x: number;
  y: number;
  side: PortSide;
  direction: 'in' | 'out' | 'inout';
  color?: string;
}> = ({ x, y, side, direction, color }) => {
  const style = color ? { fill: color } : undefined;

  if (direction === 'inout') {
    // Vertical double-headed arrow for bottom (bidirectional) ports
    return (
      <g transform={`translate(${x}, ${y})`} className="canvas-port__dir-arrow">
        <polygon points="0,-7 -3.5,-3 3.5,-3" style={style} />
        <polygon points="0,7 -3.5,3 3.5,3" style={style} />
      </g>
    );
  }

  // Arrow points in the direction of signal flow (toward block for in, away for out)
  const isLeft = side === 'left';
  const pointsRight = (isLeft && direction === 'in') || (!isLeft && direction === 'out');

  return (
    <g transform={`translate(${x}, ${y})`} className="canvas-port__dir-arrow">
      {pointsRight ? (
        <polygon points="5,0 -1,-3.5 -1,3.5" style={style} />
      ) : (
        <polygon points="-5,0 1,-3.5 1,3.5" style={style} />
      )}
    </g>
  );
};
