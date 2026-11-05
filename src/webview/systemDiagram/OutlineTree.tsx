import React, { useState } from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import { boundaryId, instanceTypeLabel, type Selection } from './model';

interface OutlineTreeProps {
  graph: SystemGraph;
  levelPath: string;
  selection: Selection | null;
  onSelect: (selection: Selection | null, levelPath?: string) => void;
}

interface RowProps {
  depth: number;
  label: string;
  detail?: string;
  current: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onSelect: () => void;
}

function OutlineRow({ depth, label, detail, current, expanded, onToggle, onSelect }: RowProps) {
  return (
    <div
      className="sd-row flex items-center"
      aria-current={current}
      style={{ paddingLeft: depth * 12 }}
    >
      {onToggle ? (
        <button
          type="button"
          className="w-5 shrink-0"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <span className={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`} />
        </button>
      ) : (
        <span className="w-5 shrink-0" />
      )}
      <button
        type="button"
        className="flex min-w-0 flex-1 items-baseline gap-2 py-0.5 text-left"
        onClick={onSelect}
      >
        <span className="truncate">{label}</span>
        {detail && <span className="truncate text-xs opacity-60">{detail}</span>}
      </button>
    </div>
  );
}

export function OutlineTree({ graph, levelPath, selection, onSelect }: OutlineTreeProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set(['/', 'ports']));
  const toggle = (key: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (!next.delete(key)) {
        next.add(key);
      }
      return next;
    });

  const renderLevel = (path: string, depth: number): React.ReactNode =>
    (graph.levels[path]?.instances ?? []).map((instancePath) => {
      const instance = graph.instances[instancePath];
      if (!instance) {
        return null;
      }
      const isHier = instance.kind === 'hier';
      return (
        <React.Fragment key={instancePath}>
          <OutlineRow
            depth={depth}
            label={instance.name}
            detail={isHier ? 'hierarchy' : instanceTypeLabel(instance)}
            current={selection?.kind === 'instance' && selection.id === instancePath}
            expanded={isHier ? expanded.has(instancePath) : undefined}
            onToggle={isHier ? () => toggle(instancePath) : undefined}
            onSelect={() => onSelect({ kind: 'instance', id: instancePath }, path)}
          />
          {isHier && expanded.has(instancePath) && renderLevel(instancePath, depth + 1)}
        </React.Fragment>
      );
    });

  return (
    <nav aria-label="Design outline" className="overflow-auto py-1">
      <OutlineRow
        depth={0}
        label={graph.name}
        detail="design"
        current={levelPath === '/' && selection === null}
        expanded={expanded.has('/')}
        onToggle={() => toggle('/')}
        onSelect={() => onSelect(null, '/')}
      />
      {expanded.has('/') && (
        <>
          {renderLevel('/', 1)}
          <OutlineRow
            depth={1}
            label="External ports"
            detail={String(graph.levels['/']?.boundaryPins.length ?? 0)}
            current={false}
            expanded={expanded.has('ports')}
            onToggle={() => toggle('ports')}
            onSelect={() => toggle('ports')}
          />
          {expanded.has('ports') &&
            (graph.levels['/']?.boundaryPins ?? []).map((pin) => (
              <OutlineRow
                key={pin.name}
                depth={2}
                label={pin.name}
                detail={pin.direction}
                current={
                  selection?.kind === 'boundary' && selection.id === boundaryId('/', pin.name)
                }
                onSelect={() => onSelect({ kind: 'boundary', id: boundaryId('/', pin.name) }, '/')}
              />
            ))}
        </>
      )}
    </nav>
  );
}
