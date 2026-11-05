import React from 'react';
import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
import { categoryColor } from './colors';
import type { ElkEdgeData } from './layout/elkLayout';

export type ElkFlowEdge = Edge<ElkEdgeData, 'elk'>;

export function ElkEdge({ id, data, selected }: EdgeProps<ElkFlowEdge>) {
  if (!data) {
    return null;
  }
  const path = data.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const width = (data.isInterface ? 2.5 : 1.25) + (selected ? 1.5 : 0);
  return (
    <BaseEdge
      id={id}
      path={path}
      interactionWidth={12}
      style={{ stroke: categoryColor(data.category), strokeWidth: width }}
    />
  );
}
