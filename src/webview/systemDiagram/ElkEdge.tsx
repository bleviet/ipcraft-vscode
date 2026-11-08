import React from 'react';
import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
import { categoryColor, restingWireColor } from './colors';
import type { ElkEdgeData } from './layout/elkLayout';

export type ElkFlowEdge = Edge<ElkEdgeData, 'elk'>;

const CROSSING_COLOR = 'var(--vscode-editorWarning-foreground)';
const DASHED = '6 4';
const DIMMED_OPACITY = 0.2;

export function ElkEdge({ id, data, selected }: EdgeProps<ElkFlowEdge>) {
  if (!data) {
    return null;
  }
  const path = data.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const width =
    (data.isInterface ? 1.75 : 1) +
    (selected ? 1.5 : 0) +
    (data.highlightColor !== undefined ? 1.25 : 0);
  const baseColor = data.domainColor ?? categoryColor(data.category);
  const stroke = data.crossing
    ? CROSSING_COLOR
    : (data.highlightColor ?? (selected ? baseColor : restingWireColor(baseColor)));
  const dash = data.crossing ? DASHED : undefined;
  return (
    <BaseEdge
      id={id}
      path={path}
      interactionWidth={12}
      style={{
        stroke,
        strokeWidth: width,
        ...(dash && { strokeDasharray: dash }),
        ...(data.dimmed && !selected && { opacity: DIMMED_OPACITY }),
      }}
    />
  );
}
