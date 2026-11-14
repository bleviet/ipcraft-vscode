import React from 'react';
import { Panel } from '@xyflow/react';
import { categoryColor } from './colors';
import type { ChangeLegend } from './changeDecor';
import {
  changeLegendEntries,
  legendEntries,
  REVIEW_LEGEND,
  type DomainLegendEntry,
} from './legend';
import { nodeBadges } from './layout/diagramBounds';
import type { DiagramFlowEdge, DiagramFlowNode } from './layout/elkLayout';

/** Bottom-left overlay naming the wire categories drawn on the current level. */
export function DiagramLegend({
  edges,
  nodes,
  review,
  domains,
  changes,
  onOpenChanges,
}: {
  edges: readonly DiagramFlowEdge[];
  nodes: readonly DiagramFlowNode[];
  /** Append the unconnected-pin entries. */
  review: boolean;
  /** Entries to append while the domain decorations are on. */
  domains?: readonly DomainLegendEntry[] | null;
  /** Entries to append while the marks of a comparison are on. */
  changes?: ChangeLegend | null;
  /** Opens the Changes tab: the removed entry is a button for it. */
  onOpenChanges?: () => void;
}) {
  const badges = nodes.flatMap((node) => nodeBadges(node).flatMap((badge) => badge.nets));
  const entries = legendEntries(
    edges.map((edge) => edge.data),
    badges
  );
  const changeEntries = changes ? changeLegendEntries(changes.kinds) : [];
  // While the ghosts are drawn the kind has its own entry; otherwise the removed things are only counted.
  const removed = changes?.kinds.includes('removed') ? 0 : (changes?.removed ?? 0);
  if (
    entries.length === 0 &&
    !review &&
    !domains &&
    changeEntries.length === 0 &&
    !changes?.newWire &&
    !changes?.removedWire &&
    removed === 0
  ) {
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
      {changeEntries.map((entry) => (
        <span key={entry.status} className="sd-legend-item">
          <i aria-hidden="true" className="sd-legend-swatch" data-change={entry.status} />
          <span className="sd-change-sign" data-change={entry.status} aria-hidden="true">
            {entry.sign}
          </span>{' '}
          {entry.label}
        </span>
      ))}
      {changes?.newWire && (
        <span className="sd-legend-item">
          <i aria-hidden="true" className="sd-legend-bar sd-legend-bar-new" />
          New wire
        </span>
      )}
      {changes?.removedWire && (
        <span className="sd-legend-item">
          <i aria-hidden="true" className="sd-legend-bar sd-legend-bar-removed" />
          Removed wire
        </span>
      )}
      {removed > 0 && (
        <button type="button" className="sd-legend-item sd-link" onClick={onOpenChanges}>
          − {removed} removed, see Changes
        </button>
      )}
    </Panel>
  );
}
