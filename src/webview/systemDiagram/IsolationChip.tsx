import React from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { IsolationHops } from './isolation';
import type { IsolatedView } from './hooks/useIsolation';
import { nodeName } from './pathTrace';

interface IsolationChipProps {
  graph: SystemGraph;
  view: IsolatedView;
  onSetHops: (hops: IsolationHops) => void;
  onShowAll: () => void;
}

const HOPS: { hops: IsolationHops; label: string }[] = [
  { hops: 1, label: '1-Hop' },
  { hops: 2, label: '2-Hop' },
];

/** Toolbar chip of the isolated view: a node isolation with its hop radius, or a traced path. */
export function IsolationChip({ graph, view, onSetHops, onShowAll }: IsolationChipProps) {
  const { trace } = view;
  const shown = `${view.nodeIds.size} of ${view.levelNodeCount} shown`;
  return (
    <span className="sd-isolated">
      <span>
        {trace
          ? `Path · ${nodeName(graph, trace.from)} -> ${nodeName(graph, trace.to)} · ${trace.order.length} blocks`
          : `Isolated · ${view.selectedCount} selected · ${shown}`}
      </span>
      {view.hops !== undefined &&
        HOPS.map(({ hops, label }) => (
          <button
            key={hops}
            type="button"
            className="sd-tool"
            aria-pressed={view.hops === hops}
            onClick={() => onSetHops(hops)}
          >
            {label}
          </button>
        ))}
      <button type="button" className="sd-tool" onClick={onShowAll}>
        Show All
      </button>
    </span>
  );
}
