import React from 'react';
import { Panel } from '@xyflow/react';
import { categoryColor } from './colors';
import { legendEntries } from './legend';
import type { DiagramFlowEdge, DiagramFlowNode } from './layout/elkLayout';

/** Bottom-left overlay naming the wire categories drawn on the current level. */
export function DiagramLegend({
  edges,
  nodes,
}: {
  edges: readonly DiagramFlowEdge[];
  nodes: readonly DiagramFlowNode[];
}) {
  const badges = nodes.flatMap((node) =>
    node.type === 'instance'
      ? [...node.data.west, ...node.data.east].flatMap((row) => row.badge?.nets ?? [])
      : (node.data.badge?.nets ?? [])
  );
  const entries = legendEntries(
    edges.map((edge) => edge.data),
    badges
  );
  if (entries.length === 0) {
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
    </Panel>
  );
}
