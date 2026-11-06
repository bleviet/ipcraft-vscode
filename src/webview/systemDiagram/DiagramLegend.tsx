import React from 'react';
import { Panel } from '@xyflow/react';
import { categoryColor } from './colors';
import { legendEntries, REVIEW_LEGEND } from './legend';
import type { DiagramFlowEdge, DiagramFlowNode } from './layout/elkLayout';

/** Bottom-left overlay naming the wire categories drawn on the current level. */
export function DiagramLegend({
  edges,
  nodes,
  review,
}: {
  edges: readonly DiagramFlowEdge[];
  nodes: readonly DiagramFlowNode[];
  /** Append the unconnected-pin entries. */
  review: boolean;
}) {
  const badges = nodes.flatMap((node) =>
    node.type === 'boundary'
      ? (node.data.badge?.nets ?? [])
      : [...node.data.west, ...node.data.east].flatMap((row) => row.badge?.nets ?? [])
  );
  const entries = legendEntries(
    edges.map((edge) => edge.data),
    badges
  );
  if (entries.length === 0 && !review) {
    return null;
  }
  return (
    <Panel position="bottom-left" className="sd-legend" aria-label="Legend">
      {entries.map((entry) => (
        <span key={entry.category} className="sd-legend-item">
          <i
            aria-hidden="true"
            className={entry.thick ? 'sd-legend-bar' : 'sd-legend-bar sd-legend-bar-thin'}
            style={{ background: categoryColor(entry.category) }}
          />
          {entry.label}
        </span>
      ))}
      {review &&
        REVIEW_LEGEND.map((entry) => (
          <span key={entry.key} className="sd-legend-item">
            <i
              aria-hidden="true"
              className={entry.dashed ? 'sd-legend-bar sd-legend-bar-dashed' : 'sd-legend-bar'}
              style={entry.color ? { background: entry.color } : undefined}
            />
            {entry.label}
          </span>
        ))}
    </Panel>
  );
}
