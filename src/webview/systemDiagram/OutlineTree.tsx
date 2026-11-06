import React, { useState } from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { ClockAnalysis } from './clocks/analyzeClocks';
import { outlineDomains, type OutlineDomains } from './clocks/domainView';
import { boundaryId, cellCount, instanceTypeLabel, type Selection } from './model';
import { nodeUnconnectedCount, type UnconnectedPin } from './unconnectedPins';

interface OutlineTreeProps {
  graph: SystemGraph;
  levelPath: string;
  selection: Selection | null;
  /** Findings to count on rows while the unconnected-pin review is on, else null. */
  review: readonly UnconnectedPin[] | null;
  /** The analysis to show domain dots and crossing counts from while the Clock domains mode is on, else null. */
  clocks: ClockAnalysis | null;
  onSelect: (selection: Selection | null, levelPath?: string) => void;
}

type IconKind = 'ip' | 'module' | 'hier' | 'port';

interface RowProps {
  depth: number;
  label: string;
  icon?: IconKind;
  detail?: string;
  /** Right-aligned muted count that never gives way to the name. */
  count?: number;
  /** Review mode: unconnected pins in this row (rolled up for a hierarchy). */
  unconnected?: { all: number; undriven: number };
  /** Domain mode: dots for the clock domains of the block, and the crossings inside a hierarchy. */
  domains?: OutlineDomains;
  current: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  onSelect: () => void;
}

function OutlineRow({
  depth,
  label,
  icon,
  detail,
  count,
  unconnected,
  domains,
  current,
  expanded,
  onToggle,
  onSelect,
}: RowProps) {
  const dots = domains !== undefined && domains.colors.length > 0;
  const crossings = domains !== undefined && domains.crossings > 0;
  const trailing = (unconnected?.all ?? 0) > 0 || dots || crossings;
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
        className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 pr-2 text-left"
        onClick={onSelect}
      >
        {icon && <span aria-hidden="true" className={`sd-ico sd-ico-${icon}`} />}
        <span className="min-w-0 truncate">{label}</span>
        {detail && (
          <span className="min-w-0 flex-1 basis-0 truncate text-xs opacity-60">{detail}</span>
        )}
        {dots && (
          <span className="sd-dots ml-auto" title={domains.title} aria-hidden="true">
            {domains.colors.map((color, index) => (
              <i key={index} style={{ background: color }} />
            ))}
          </span>
        )}
        {crossings && (
          <span
            className={`${dots ? 'ml-1.5' : 'ml-auto'} shrink-0 text-[11px] text-[var(--vscode-editorWarning-foreground)]`}
            title="Clock and reset domain crossings inside"
          >
            <span className="sr-only"> </span>
            {domains.crossings}
          </span>
        )}
        {unconnected && unconnected.all > 0 && (
          <span
            className="ml-auto shrink-0 text-[11px]"
            title={`${unconnected.undriven} undriven, ${unconnected.all - unconnected.undriven} unused`}
            style={{
              color:
                unconnected.undriven > 0
                  ? 'var(--vscode-editorWarning-foreground)'
                  : 'var(--vscode-descriptionForeground)',
            }}
          >
            <span className="sr-only"> </span>
            {unconnected.all}
          </span>
        )}
        {count !== undefined && (
          <span
            className={`${trailing ? 'ml-1.5' : 'ml-auto'} shrink-0 text-[11px] text-[var(--vscode-descriptionForeground)]`}
          >
            <span className="sr-only"> </span>
            {count}
          </span>
        )}
      </button>
    </div>
  );
}

export function OutlineTree({
  graph,
  levelPath,
  selection,
  review,
  clocks,
  onSelect,
}: OutlineTreeProps) {
  const unconnectedOf = (nodeId: string) =>
    review ? nodeUnconnectedCount(review, nodeId, graph) : undefined;
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
            icon={instance.kind}
            detail={isHier ? undefined : instanceTypeLabel(instance)}
            count={isHier ? cellCount(graph, instancePath) : undefined}
            unconnected={unconnectedOf(instancePath)}
            domains={clocks ? outlineDomains(clocks, graph, instancePath) : undefined}
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
    <nav aria-label="Design outline" className="min-h-0 flex-1 overflow-auto pb-3">
      <h3 className="sd-section">Outline</h3>
      <OutlineRow
        depth={0}
        label={graph.name}
        detail="design"
        unconnected={
          review
            ? {
                all: review.length,
                undriven: review.filter((finding) => finding.cls === 'undriven').length,
              }
            : undefined
        }
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
                icon="port"
                detail={pin.direction}
                unconnected={unconnectedOf(boundaryId('/', pin.name))}
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
