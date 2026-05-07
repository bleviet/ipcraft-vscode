import React from 'react';
import type { LayoutPort } from './canvasLayout';
import { STUB_LENGTH } from './canvasLayout';

import { ValidationAnnotation } from '../../hooks/useCanvasValidation';

interface CanvasPortProps {
  port: LayoutPort;
  selected: boolean;
  annotations?: ValidationAnnotation[];
  onSelect: (id: string) => void;
  domainColor?: string;
}

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
  annotations,
  onSelect,
  domainColor,
}) => {
  const isLeft = port.side === 'left';
  const isRight = port.side === 'right';
  const isBottom = port.side === 'bottom';

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

  // Port kind icon
  const icon = portKindIcon(port.kind);

  // Connector dot radius
  const dotR = port.kind === 'bus' ? 5 : 3;

  return (
    <g
      className={`canvas-port canvas-port--${port.kind} ${selected ? 'canvas-port--selected' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(port.id);
      }}
      data-port-id={port.id}
      style={{ cursor: 'grab' }}
      onDragStart={(e) => {
        // Need to stop propagation so parent drag isn't triggered
        e.stopPropagation();
        const payload = { action: 'remove', kind: port.kind, id: port.id };
        e.dataTransfer.setData('application/x-ipcraft-remove', JSON.stringify(payload));
        e.dataTransfer.effectAllowed = 'move';

        // Visual feedback during drag
        const target = e.currentTarget as SVGGElement;
        setTimeout(() => {
          target.style.opacity = '0.4';
        }, 0);
      }}
      onDragEnd={(e) => {
        const target = e.currentTarget as SVGGElement;
        target.style.opacity = '1';
      }}
    >
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
      <circle
        cx={port.x}
        cy={port.y}
        r={dotR}
        className="canvas-port__dot"
        style={domainColor ? { fill: domainColor } : undefined}
      />

      {/* Port kind icon (clock/reset) — placed inside the block body */}
      {icon && (
        <text
          x={isLeft ? port.x + 14 : isRight ? port.x - 14 : port.x}
          y={isBottom ? port.y - 14 : port.y}
          className="canvas-port__icon"
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={11}
          style={domainColor ? { fill: domainColor } : undefined}
        >
          {icon}
        </text>
      )}

      {/* Port label */}
      <text
        x={labelX}
        y={labelY}
        textAnchor={textAnchor}
        dominantBaseline="central"
        className="canvas-port__label"
      >
        {port.label}
      </text>

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

function portKindIcon(kind: string): string | null {
  switch (kind) {
    case 'clock':
      return '\ud83d\udd50'; // clock symbol
    case 'reset':
      return '\u21BA'; // counterclockwise arrow
    default:
      return null;
  }
}
