import React from 'react';
import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
import { categoryColor, restingWireColor } from './colors';
import type { ElkEdgeData } from './layout/elkLayout';

export type ElkFlowEdge = Edge<ElkEdgeData, 'elk'>;

const CROSSING_COLOR = 'var(--vscode-editorWarning-foreground)';
const DASHED = '6 4';
const DIMMED_OPACITY = 0.2;
/** Extra width of a selected wire; a highlighted wire gets the same bump. */
const EMPHASIS_WIDTH = 1.5;
const HALO_EXTRA_WIDTH = 4;
const HALO_OPACITY = 0.3;

export function ElkEdge({ id, data, selected }: EdgeProps<ElkFlowEdge>) {
  if (!data) {
    return null;
  }
  const path = data.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const width =
    (data.isInterface ? 1.75 : 1) +
    (selected ? EMPHASIS_WIDTH : 0) +
    (data.highlightColor !== undefined ? EMPHASIS_WIDTH : 0);
  const baseColor = data.domainColor ?? categoryColor(data.category);
  // A dimmed wire is already faded; muting it as well would hide it.
  const fullColor = selected === true || data.dimmed === true;
  const stroke = data.crossing
    ? CROSSING_COLOR
    : (data.highlightColor ?? (fullColor ? baseColor : restingWireColor(baseColor)));
  const dash = data.crossing ? DASHED : undefined;
  const faded = data.dimmed && !selected;
  return (
    <>
      {data.highlightColor !== undefined && (
        <path
          className="sd-edge-halo"
          d={path}
          fill="none"
          stroke={data.highlightColor}
          strokeWidth={width + HALO_EXTRA_WIDTH}
          strokeOpacity={HALO_OPACITY}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'none', ...(faded && { opacity: DIMMED_OPACITY }) }}
        />
      )}
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={12}
        style={{
          stroke,
          strokeWidth: width,
          ...(dash && { strokeDasharray: dash }),
          ...(faded && { opacity: DIMMED_OPACITY }),
        }}
      />
    </>
  );
}
