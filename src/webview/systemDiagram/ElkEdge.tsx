import React from 'react';
import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
import { categoryColor } from './colors';
import { longestSegmentMidpoint } from './layout/edgePoints';
import type { ElkEdgeData } from './layout/elkLayout';

export type ElkFlowEdge = Edge<ElkEdgeData, 'elk'>;

const CROSSING_COLOR = 'var(--vscode-editorWarning-foreground)';
const DOTTED = '2 3';
const DASHED = '6 4';
const DIMMED_OPACITY = 0.2;

const BADGE_CHAR_WIDTH = 6.5;
const BADGE_PADDING = 8;
const BADGE_HEIGHT = 14;

const subpath = (points: readonly { x: number; y: number }[]) =>
  points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');

/** The count badge of a bundle, centred on the longest segment of its trunk. */
function BundleBadge({
  label,
  points,
  stroke,
  opacity,
}: {
  label: string;
  points: ElkEdgeData['points'];
  stroke: string;
  opacity?: number;
}) {
  const at = longestSegmentMidpoint(points);
  if (!at) {
    return null;
  }
  const width = label.length * BADGE_CHAR_WIDTH + BADGE_PADDING;
  return (
    <g className="sd-bundle-badge" style={{ stroke, opacity }}>
      <rect
        x={at.x - width / 2}
        y={at.y - BADGE_HEIGHT / 2}
        width={width}
        height={BADGE_HEIGHT}
        rx={3}
      />
      <text x={at.x} y={at.y} textAnchor="middle" dominantBaseline="central">
        {label}
      </text>
    </g>
  );
}

export function ElkEdge({ id, data, selected }: EdgeProps<ElkFlowEdge>) {
  if (!data) {
    return null;
  }
  const path = [data.points, ...(data.bundle?.branches ?? [])].map(subpath).join(' ');
  const width =
    (data.isInterface ? 2.5 : 1.25) +
    (selected ? 1.5 : 0) +
    (data.highlightColor !== undefined ? 1.25 : 0);
  const stroke = data.crossing
    ? CROSSING_COLOR
    : (data.highlightColor ?? data.domainColor ?? categoryColor(data.category));
  const dash = data.crossing ? DASHED : data.dotted ? DOTTED : undefined;
  const opacity = data.dimmed && !selected ? DIMMED_OPACITY : undefined;
  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={12}
        style={{
          stroke,
          strokeWidth: width,
          ...(dash && { strokeDasharray: dash }),
          ...(opacity !== undefined && { opacity }),
        }}
      />
      {data.bundle && (
        <BundleBadge
          label={data.bundle.label}
          points={data.points}
          stroke={stroke}
          opacity={opacity}
        />
      )}
    </>
  );
}
