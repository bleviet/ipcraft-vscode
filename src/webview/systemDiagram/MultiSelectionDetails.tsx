import React from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import { nodeSelection, parseBoundaryId, type Selection } from './model';

interface MultiSelectionDetailsProps {
  graph: SystemGraph;
  nodeIds: readonly string[];
  onSelect: (selection: Selection) => void;
}

/** Details of a multi-selection: its size and one link per node that selects it alone. */
export function MultiSelectionDetails({ graph, nodeIds, onSelect }: MultiSelectionDetailsProps) {
  return (
    <div className="space-y-3">
      <header>
        <div className="sd-eyebrow">Selection</div>
        <h2 className="sd-h2">{nodeIds.length} selected</h2>
      </header>
      <ul>
        {nodeIds.map((id) => {
          const instance = graph.instances[id];
          return (
            <li key={id}>
              <button type="button" className="sd-link" onClick={() => onSelect(nodeSelection(id))}>
                {instance ? instance.name : parseBoundaryId(id).pin}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
