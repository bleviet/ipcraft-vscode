import React, { useMemo, useState } from 'react';
import {
  TRANSFORM_OPERATIONS,
  TRANSFORM_PRESETS,
  type RecipeStepType,
  type TransformPresetId,
} from './transform/operations';

export const DATA_INSPECTOR_NODE_MIME = 'application/ipcraft-data-node';
export const DATA_INSPECTOR_OPERATION_MIME = 'application/ipcraft-operation';
export const DATA_INSPECTOR_PRESET_MIME = 'application/ipcraft-preset';

interface WorkbenchLibraryProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onAddNode: (kind: 'source' | 'output') => void;
  onAddOperation: (type: RecipeStepType) => void;
  onAddPreset: (preset: TransformPresetId) => void;
}

function beginDrag(event: React.DragEvent, mime: string, value: string) {
  event.dataTransfer.setData(mime, value);
  event.dataTransfer.effectAllowed = 'copy';
}

export function WorkbenchLibrary({
  collapsed,
  onToggleCollapsed,
  onAddNode,
  onAddOperation,
  onAddPreset,
}: WorkbenchLibraryProps) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const operations = useMemo(
    () =>
      TRANSFORM_OPERATIONS.filter((operation) =>
        `${operation.label} ${operation.description}`.toLowerCase().includes(normalizedQuery)
      ),
    [normalizedQuery]
  );
  const presets = useMemo(
    () =>
      TRANSFORM_PRESETS.filter((preset) => preset.label.toLowerCase().includes(normalizedQuery)),
    [normalizedQuery]
  );

  if (collapsed) {
    return (
      <aside className="di-library is-collapsed" aria-label="Transform Library">
        <button
          className="di-rail-toggle"
          aria-label="Expand Library"
          onClick={onToggleCollapsed}
          title="Expand Library"
        >
          <span className="codicon codicon-library" aria-hidden="true" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="di-library" aria-label="Transform Library">
      <header className="di-rail-header">
        <div>
          <span className="di-eyebrow">Build the graph</span>
          <h2>Library</h2>
        </div>
        <button
          className="di-icon-button"
          aria-label="Collapse Library"
          onClick={onToggleCollapsed}
          title="Collapse Library"
        >
          <span className="codicon codicon-layout-sidebar-left-off" aria-hidden="true" />
        </button>
      </header>

      <label className="di-search di-library-search">
        <span className="codicon codicon-search" aria-hidden="true" />
        <span className="sr-only">Search Library</span>
        <input
          placeholder="Search nodes and operators"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>

      <section className="di-library-section">
        <h3>Nodes</h3>
        <div className="di-library-grid is-nodes">
          {(
            [
              { kind: 'source', symbol: 'IN', label: 'Input', description: 'Transient bit vector' },
              { kind: 'output', symbol: 'OUT', label: 'Output', description: 'Named graph result' },
            ] as const
          )
            .filter((item) =>
              `${item.label} ${item.description}`.toLowerCase().includes(normalizedQuery)
            )
            .map((item) => (
              <button
                aria-label={item.kind === 'source' ? 'Add source' : 'Add output'}
                draggable
                key={item.kind}
                onClick={() => onAddNode(item.kind)}
                onDragStart={(event) => beginDrag(event, DATA_INSPECTOR_NODE_MIME, item.kind)}
                title={`Drag ${item.label} onto the transform canvas`}
              >
                <b aria-hidden="true">{item.symbol}</b>
                <span>{item.label}</span>
                <small>{item.description}</small>
              </button>
            ))}
        </div>
      </section>

      <section className="di-library-section">
        <h3>Operators</h3>
        <div className="di-library-grid">
          {operations.map((operation) => (
            <button
              aria-label={`Add ${operation.label} draft`}
              draggable
              key={operation.type}
              onClick={() => onAddOperation(operation.type)}
              onDragStart={(event) =>
                beginDrag(event, DATA_INSPECTOR_OPERATION_MIME, operation.type)
              }
              title={`Drag ${operation.label} onto the transform canvas`}
            >
              <b aria-hidden="true">{operation.symbol}</b>
              <span>{operation.label}</span>
              <small>{operation.description}</small>
            </button>
          ))}
          {operations.length === 0 && <p className="di-note">No matching operators.</p>}
        </div>
      </section>

      <section className="di-library-section">
        <h3>Presets</h3>
        <div className="di-library-grid is-presets">
          {presets.map((preset) => (
            <button
              aria-label={`Add ${preset.label} preset`}
              draggable
              key={preset.id}
              onClick={() => onAddPreset(preset.id)}
              onDragStart={(event) => beginDrag(event, DATA_INSPECTOR_PRESET_MIME, preset.id)}
              title={`Drag ${preset.label} onto the transform canvas`}
            >
              <b aria-hidden="true">{preset.symbol}</b>
              <span>{preset.label}</span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
