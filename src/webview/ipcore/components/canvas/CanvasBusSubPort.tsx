import React from 'react';
import type { LayoutSubPort } from './canvasLayout';
import { STUB_LENGTH } from './canvasLayout';

interface CanvasBusSubPortProps {
  subPort: LayoutSubPort;
  onActivate: (subPortId: string) => void;
  onDeactivate: (subPortId: string) => void;
}

/**
 * Renders a single signal stub for an expanded bus interface.
 *
 * Logical signal name (e.g. AWADDR[31:0]) is shown inside the block.
 * Physical port name (e.g. s_axi_awaddr[31:0]) is shown on the external stub.
 *
 * Required and active-optional ports show a solid stub.
 * Inactive optional ports show a dashed stub and are clickable to activate.
 */
export const CanvasBusSubPort: React.FC<CanvasBusSubPortProps> = ({
  subPort,
  onActivate,
  onDeactivate,
}) => {
  const isLeft = subPort.side === 'left';
  const stubDir = isLeft ? -1 : 1;
  const stubEndX = subPort.x + stubDir * STUB_LENGTH;

  const isOptional = subPort.presence === 'optional';
  const isInactive = isOptional && !subPort.active;

  // Logical label shown inside the block (signal role within the bus protocol)
  const logicalLabel = subPort.widthLabel ? `${subPort.name}${subPort.widthLabel}` : subPort.name;

  // Physical label shown outside on the stub (actual HDL port name)
  const physicalName = `${subPort.physicalPrefix}${subPort.name.toLowerCase()}`;
  const physicalLabel = subPort.widthLabel ? `${physicalName}${subPort.widthLabel}` : physicalName;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isInactive) {
      onActivate(subPort.id);
    } else if (isOptional && subPort.active) {
      onDeactivate(subPort.id);
    }
  };

  return (
    <g
      className={`canvas-bus-subport ${isInactive ? 'canvas-bus-subport--inactive' : 'canvas-bus-subport--active'} ${isOptional ? 'canvas-bus-subport--optional' : ''}`}
      onClick={isOptional ? handleClick : undefined}
      style={{ cursor: isOptional ? 'pointer' : 'default' }}
      role={isOptional ? 'button' : undefined}
    >
      {/* Stub line */}
      <line
        x1={subPort.x}
        y1={subPort.y}
        x2={stubEndX}
        y2={subPort.y}
        className="canvas-bus-subport__line"
        strokeDasharray={isInactive ? '4 3' : undefined}
      />

      {/* Tiny dot at block edge */}
      <circle cx={subPort.x} cy={subPort.y} r={2} className="canvas-bus-subport__dot" />

      {/* Logical name — inside the block */}
      <text
        x={subPort.x + (isLeft ? 8 : -8)}
        y={subPort.y}
        textAnchor={isLeft ? 'start' : 'end'}
        dominantBaseline="central"
        className="canvas-bus-subport__logical"
      >
        {logicalLabel}
      </text>

      {/* Physical port name — outside on the stub */}
      <text
        x={stubEndX + stubDir * 5}
        y={subPort.y}
        textAnchor={isLeft ? 'end' : 'start'}
        dominantBaseline="central"
        className="canvas-bus-subport__label"
      >
        {physicalLabel}
      </text>

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
    </g>
  );
};
