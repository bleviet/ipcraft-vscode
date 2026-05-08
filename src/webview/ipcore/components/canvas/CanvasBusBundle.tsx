import React from 'react';
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
}

/**
 * Renders a bus interface as a wide "bundle" connector on the block edge.
 *
 * Visually distinct from regular ports: thicker stub, protocol badge, mode indicator.
 * Supports expand/collapse to show individual bus port signals.
 */
export const CanvasBusBundle: React.FC<CanvasBusBundleProps> = ({
  port,
  selected,
  annotations,
  onSelect,
  isExpanded = false,
  onToggleExpand,
  domainColor,
}) => {
  const isLeft = port.side === 'left';

  const hasError = annotations?.some((a) => a.severity === 'error');
  const tooltipText = annotations
    ?.map((a) => `[${a.severity.toUpperCase()}] ${a.message}`)
    .join('\n');

  // Bundle stub geometry (thicker "bus" line)
  const stubDir = isLeft ? -1 : 1;
  const stubEndX = port.x + stubDir * STUB_LENGTH;

  // Protocol badge position
  const badgeX = port.x + stubDir * (STUB_LENGTH + 8);
  const badgeY = port.y;

  // Expand toggle button position (at the stub tip)
  const toggleX = stubEndX + stubDir * 6;
  const toggleY = port.y;

  return (
    <g
      className={`canvas-bus-bundle ${selected ? 'canvas-bus-bundle--selected' : ''} ${isExpanded ? 'canvas-bus-bundle--expanded' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(port.id);
      }}
      data-port-id={port.id}
      style={{ cursor: 'grab' }}
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
      </g>

      {/* Mode indicator (S/M) */}
      {port.mode && (
        <g transform={`translate(${port.x + stubDir * (STUB_LENGTH / 2)}, ${port.y - 12})`}>
          <rect x={-10} y={-8} width={20} height={16} rx={3} className="canvas-bus-bundle__mode" />
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

      {/* Name label (INSIDE the block) */}
      <text
        x={port.x + (isLeft ? 12 : -12)}
        y={port.y}
        textAnchor={isLeft ? 'start' : 'end'}
        dominantBaseline="central"
        className="canvas-bus-bundle__name"
      >
        {port.label}
      </text>

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
            x={isLeft ? -16 : 0}
            y={-8}
            width={16}
            height={16}
            rx={3}
            className="canvas-bus-bundle__expand-bg"
          />
          <text
            x={isLeft ? -8 : 8}
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

      {/* Validation Indicator */}
      {annotations && annotations.length > 0 && (
        <circle
          cx={port.x + stubDir * (STUB_LENGTH / 2)}
          cy={port.y - 20}
          r={5}
          className={`ip-canvas-annotation-dot ${hasError ? 'ip-canvas-annotation-dot--error' : 'ip-canvas-annotation-dot--warning'}`}
        >
          <title>{tooltipText}</title>
        </circle>
      )}
    </g>
  );
};
