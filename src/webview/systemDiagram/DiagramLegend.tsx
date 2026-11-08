import React from 'react';
import { Panel } from '@xyflow/react';
import { categoryColor } from './colors';
import { legendEntries, REVIEW_LEGEND, type DomainLegendEntry } from './legend';
import { nodeBadges } from './layout/diagramBounds';
import type { DiagramFlowEdge, DiagramFlowNode } from './layout/elkLayout';

/** Bottom-left overlay naming the wire categories drawn on the current level. */
export function DiagramLegend({
  edges,
  nodes,
  review,
  domains,
}: {
  edges: readonly DiagramFlowEdge[];
  nodes: readonly DiagramFlowNode[];
  /** Append the unconnected-pin entries. */
  review: boolean;
  /** Entries to append while the domain decorations are on. */
  domains?: readonly DomainLegendEntry[] | null;
}) {
  const badges = nodes.flatMap((node) => nodeBadges(node).flatMap((badge) => badge.nets));
  const entries = legendEntries(
    edges.map((edge) => edge.data),
    badges
  );
  if (entries.length === 0 && !review && !domains) {
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
      {domains?.map((entry) => (
        <span key={entry.key} className="sd-legend-item">
          <i
            aria-hidden="true"
            className={`sd-legend-bar${entry.line ? ` sd-legend-bar-${entry.line}` : ' sd-legend-bar-thin'}`}
            style={entry.line ? { borderTopColor: entry.color } : { background: entry.color }}
          />
          {entry.label}
        </span>
      ))}
    </Panel>
  );
}
