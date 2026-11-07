import React from 'react';
import { Panel } from '@xyflow/react';
import type { NetCategory } from '../../domain/systemGraph';
import { categoryColor } from './colors';
import { legendEntries, REVIEW_LEGEND, type DomainLegendEntry } from './legend';
import type { DiagramFlowEdge, DiagramFlowNode } from './layout/elkLayout';

/** Bottom-left overlay naming the wire categories drawn on the current level. */
export function DiagramLegend({
  edges,
  nodes,
  review,
  domains,
  hidden,
  onToggleLayer,
  onSoloLayer,
}: {
  edges: readonly DiagramFlowEdge[];
  nodes: readonly DiagramFlowNode[];
  /** Append the unconnected-pin entries. */
  review: boolean;
  /** Entries to append while the domain decorations are on. */
  domains?: readonly DomainLegendEntry[] | null;
  /** Wire categories drawn dimmed in the legend because their wires are hidden. */
  hidden?: ReadonlySet<NetCategory>;
  /** Click on a category: hide or show its wires. Without it the chips are plain labels. */
  onToggleLayer?: (category: NetCategory) => void;
  /** Alt+Click: show only that category of `all`, or all again. */
  onSoloLayer?: (category: NetCategory, all: readonly NetCategory[]) => void;
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
  const wired = entries
    .map((entry) => entry.category)
    .filter((c) => edges.some((e) => e.data.category === c));
  if (entries.length === 0 && !review && !domains) {
    return null;
  }
  return (
    <Panel position="bottom-left" className="sd-legend" aria-label="Legend">
      {entries.map((entry) => {
        const bar = (
          <i
            aria-hidden="true"
            className={entry.thick ? 'sd-legend-bar' : 'sd-legend-bar sd-legend-bar-thin'}
            style={{ background: categoryColor(entry.category) }}
          />
        );
        // A category listed only from badges has no wire to hide: a plain entry.
        if (!wired.includes(entry.category)) {
          return (
            <span key={entry.category} className="sd-legend-item">
              {bar}
              {entry.label}
            </span>
          );
        }
        return (
          <button
            key={entry.category}
            type="button"
            className="sd-legend-item sd-legend-chip nodrag nopan"
            aria-pressed={!hidden?.has(entry.category)}
            title="Click to hide or show these wires; Alt+Click to show only these"
            onClick={(event) =>
              event.altKey ? onSoloLayer?.(entry.category, wired) : onToggleLayer?.(entry.category)
            }
          >
            {bar}
            {entry.label}
          </button>
        );
      })}
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
