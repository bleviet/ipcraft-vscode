import React from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import { nodeSelection, parseBoundaryId, type Selection } from './model';

interface MultiSelectionDetailsProps {
  graph: SystemGraph;
  items?: readonly Selection[];
  nodeIds?: readonly string[];
  onSelect: (selection: Selection) => void;
}

function itemLabel(graph: SystemGraph, item: Selection): string {
  switch (item.kind) {
    case 'instance':
      return graph.instances[item.id]?.name ?? item.id;
    case 'boundary':
      return parseBoundaryId(item.id).pin;
    case 'net':
      return graph.nets.find((net) => net.id === item.id)?.name ?? parseBoundaryId(item.id).pin;
  }
}

/** Details of a multi-selection: its size and one link per item that selects it alone. */
export function MultiSelectionDetails({
  graph,
  items,
  nodeIds,
  onSelect,
}: MultiSelectionDetailsProps) {
  const list = items ?? (nodeIds ?? []).map(nodeSelection);
  return (
    <div className="space-y-3">
      <header>
        <div className="sd-eyebrow">Selection</div>
        <h2 className="sd-h2">{list.length} selected</h2>
      </header>
      <ul>
        {list.map((item) => (
          <li key={`${item.kind}:${item.id}`}>
            <button type="button" className="sd-link" onClick={() => onSelect(item)}>
              {itemLabel(graph, item)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
