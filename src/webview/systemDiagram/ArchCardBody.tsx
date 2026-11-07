import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { categoryColor } from './colors';
import {
  ARCH_BOTTOM_PADDING,
  ARCH_EAST,
  ARCH_PILL_HEIGHT,
  ARCH_PREVIEW_HEIGHT,
  ARCH_WEST,
} from './layout/archCard';
import type { ArchSummary } from './layout/diagramTypes';

const SIDES = [
  { id: ARCH_WEST, position: Position.Left, edge: 'left' },
  { id: ARCH_EAST, position: Position.Right, edge: 'right' },
] as const;

/** Body of an Arch card, below the header: interface count pills, a hierarchy preview and the two side handles. */
export function ArchCardBody({ summary }: { summary: ArchSummary }) {
  return (
    <div style={{ paddingBottom: ARCH_BOTTOM_PADDING }}>
      <div className="sd-arch-pills" style={{ height: ARCH_PILL_HEIGHT }}>
        {summary.pills.map((pill) => (
          <span key={pill.category} className="sd-arch-pill">
            <i aria-hidden="true" style={{ background: categoryColor(pill.category) }} />
            {pill.label}
          </span>
        ))}
        {summary.more > 0 && <span className="sd-arch-pill">+{summary.more}</span>}
      </div>
      {summary.preview !== undefined && (
        <div className="sd-arch-preview" style={{ height: ARCH_PREVIEW_HEIGHT }}>
          {summary.preview}
        </div>
      )}
      {SIDES.flatMap(({ id, position, edge }) =>
        (['source', 'target'] as const).map((type) => (
          <Handle
            key={`${id}:${type}`}
            type={type}
            id={id}
            position={position}
            isConnectable={false}
            className="sd-handle"
            style={{ top: '50%', [edge]: -1 }}
          />
        ))
      )}
    </div>
  );
}
