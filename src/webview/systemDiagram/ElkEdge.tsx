import React from 'react';
import { BaseEdge, type Edge, type EdgeProps } from '@xyflow/react';
import { categoryColor, restingWireColor } from './colors';
import type { ElkEdgeData } from './layout/elkLayout';
import { JUNCTION_RADIUS } from './layout/diagramTypes';

export type ElkFlowEdge = Edge<ElkEdgeData, 'elk'>;

const CROSSING_COLOR = 'var(--vscode-editorWarning-foreground)';
const DASHED = '6 4';
const DIMMED_OPACITY = 0.2;
/** Extra width of a selected wire; a highlighted wire gets the same bump. */
const EMPHASIS_WIDTH = 1.5;
/** Extra width of a new wire (comparison marks on). */
const NEW_WIRE_WIDTH = 0.75;
const NEW_WIRE_COLOR = 'var(--sd-change-added)';
const HALO_EXTRA_WIDTH = 4;
const HALO_OPACITY = 0.3;

export function ElkEdge({ id, data, selected }: EdgeProps<ElkFlowEdge>) {
  if (!data) {
    return null;
  }
  const draw = (points: readonly { x: number; y: number }[]) =>
    points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const path = draw(data.points);
  // The lead is drawn with the wire: React Flow culls an edge by its own two nodes.
  const wirePath = data.lead ? draw([...data.lead, ...data.points.slice(1)]) : path;
  // The wire as it is drawn without the new-wire mark; the lead of a branch always keeps it,
  // because the trunk belongs to the other wires of the net.
  const width =
    (data.isInterface ? 1.75 : 1) +
    (selected ? EMPHASIS_WIDTH : 0) +
    (data.highlightColor !== undefined ? EMPHASIS_WIDTH : 0);
  const baseColor = data.domainColor ?? categoryColor(data.category);
  // A dimmed wire is already faded; muting it as well would hide it.
  const fullColor = selected === true || data.dimmed === true;
  const plainStroke = data.crossing
    ? CROSSING_COLOR
    : (data.highlightColor ?? (fullColor ? baseColor : restingWireColor(baseColor)));
  // A new wire is wider; it takes the added color unless the selection, a highlight, a crossing or
  // a clock domain color already says something with it.
  const markedColor =
    data.changeNew && selected !== true && plainStroke !== data.highlightColor && !data.crossing
      ? data.domainColor === undefined
        ? NEW_WIRE_COLOR
        : plainStroke
      : plainStroke;
  const ownWidth = width + (data.changeNew ? NEW_WIRE_WIDTH : 0);
  const stroke = markedColor;
  // Only the wire's own points are marked: the lead is drawn over by them.
  const split = data.lead !== undefined && (stroke !== plainStroke || ownWidth !== width);
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
          strokeWidth={ownWidth + HALO_EXTRA_WIDTH}
          strokeOpacity={HALO_OPACITY}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: 'none', ...(faded && { opacity: DIMMED_OPACITY }) }}
        />
      )}
      <BaseEdge
        id={id}
        path={wirePath}
        interactionWidth={12}
        className={data.changeNew && !split ? 'sd-edge-new' : undefined}
        style={{
          stroke: split ? plainStroke : stroke,
          strokeWidth: split ? width : ownWidth,
          ...(dash && { strokeDasharray: dash }),
          ...(faded && { opacity: DIMMED_OPACITY }),
        }}
      />
      {split && (
        <path
          className="sd-edge-new"
          d={path}
          fill="none"
          stroke={stroke}
          strokeWidth={ownWidth}
          {...(dash && { strokeDasharray: dash })}
          style={{ pointerEvents: 'none', ...(faded && { opacity: DIMMED_OPACITY }) }}
        />
      )}
      {data.junction && (
        <circle
          cx={data.points[0].x}
          cy={data.points[0].y}
          r={JUNCTION_RADIUS}
          fill={stroke}
          style={{ pointerEvents: 'none', ...(faded && { opacity: DIMMED_OPACITY }) }}
        />
      )}
    </>
  );
}
