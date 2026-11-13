import React, { useMemo, useState } from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import {
  insideLabel,
  markSign,
  shownInside,
  type ChangeMarks,
  type NodeChange,
} from './changeMarks';
import type { ClockAnalysis } from './clocks/analyzeClocks';
import { outlineDomains, type OutlineDomains } from './clocks/domainView';
import { boundaryId, cellCount, instanceTypeLabel, type Selection } from './model';
import { withAncestors } from './search';
import { nodeUnconnectedCount, type UnconnectedPin } from './unconnectedPins';

interface OutlineTreeProps {
  graph: SystemGraph;
  levelPath: string;
  selection: Selection | null;
  /** Instance paths the search matches: the tree then lists only them, under their hierarchies. Null without a search. */
  searchMatches: readonly string[] | null;
  /** Findings to count on rows while the unconnected-pin review is on, else null. */
  review: readonly UnconnectedPin[] | null;
  /** The analysis to show domain dots and crossing counts from while the domain decorations are on, else null. */
  clocks: ClockAnalysis | null;
  /** The marks of a comparison to show on rows while Marks is on, else null. */
  changes?: ChangeMarks | null;
  onSelect: (selection: Selection | null, levelPath?: string) => void;
}

type IconKind = 'ip' | 'module' | 'hier' | 'blackbox' | 'port';

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
  /** Comparison marks on: the sign of the row's kind of change, and the count of changes below a hierarchy. */
  change?: Pick<NodeChange, 'status' | 'title' | 'inside'>;
  /** A row a search keeps only for the matches below it. */
  muted?: boolean;
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
  change,
  muted,
  current,
  expanded,
  onToggle,
  onSelect,
}: RowProps) {
  const dots = domains !== undefined && domains.colors.length > 0;
  const crossings = domains !== undefined && domains.crossings > 0;
  const inside = change?.inside ?? 0;
  const trailing = (unconnected?.all ?? 0) > 0 || dots || crossings || inside > 0;
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
        className={`flex min-w-0 flex-1 items-center gap-1.5 py-0.5 pr-2 text-left${muted ? ' opacity-60' : ''}`}
        onClick={onSelect}
      >
        {icon && <span aria-hidden="true" className={`sd-ico sd-ico-${icon}`} />}
        <span className="min-w-0 truncate">{label}</span>
        {change?.status && (
          <span
            className="sd-change-sign shrink-0"
            data-change={change.status}
            role="img"
            title={change.title}
            aria-label={change.title}
          >
            {markSign(change.status)}
          </span>
        )}
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
        {inside > 0 && (
          <span
            className={`${dots || crossings || (unconnected?.all ?? 0) > 0 ? 'ml-1.5' : 'ml-auto'} shrink-0 text-[11px] text-[var(--sd-change-changed)]`}
            role="img"
            title={insideLabel(inside)}
            aria-label={insideLabel(inside)}
          >
            <span className="sr-only"> </span>~{inside}
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

/** The marks of an instance row: its status and title, and the changes below it unless it is added. */
function blockChange(marks: ChangeMarks | null | undefined, path: string): NodeChange | undefined {
  const block = marks?.blocks.get(path);
  return block && { status: block.status, title: block.title, inside: shownInside(block) };
}

export function OutlineTree({
  graph,
  levelPath,
  selection,
  searchMatches,
  review,
  clocks,
  changes,
  onSelect,
}: OutlineTreeProps) {
  // While a search is on, the tree is its result list: the matches and the hierarchies above them, all open.
  const matched = useMemo(() => (searchMatches ? new Set(searchMatches) : null), [searchMatches]);
  const shown = useMemo(
    () => (searchMatches ? withAncestors(searchMatches) : null),
    [searchMatches]
  );
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
      if (!instance || (shown && !shown.has(instancePath))) {
        return null;
      }
      const isHier = instance.kind === 'hier';
      const open = shown !== null || expanded.has(instancePath);
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
            change={blockChange(changes, instancePath)}
            muted={matched !== null && !matched.has(instancePath)}
            current={selection?.kind === 'instance' && selection.id === instancePath}
            expanded={isHier ? open : undefined}
            onToggle={isHier && !shown ? () => toggle(instancePath) : undefined}
            onSelect={() => onSelect({ kind: 'instance', id: instancePath }, path)}
          />
          {isHier && open && renderLevel(instancePath, depth + 1)}
        </React.Fragment>
      );
    });

  return (
    <nav aria-label="Design outline" className="min-h-0 flex-1 overflow-auto pb-3">
      <h3 className="sd-section">{shown ? 'Search results' : 'Outline'}</h3>
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
        muted={shown !== null}
        current={levelPath === '/' && selection === null}
        expanded={shown !== null || expanded.has('/')}
        onToggle={shown ? undefined : () => toggle('/')}
        onSelect={() => onSelect(null, '/')}
      />
      {shown &&
        (shown.size > 0 ? (
          renderLevel('/', 1)
        ) : (
          <p className="px-5 py-0.5 opacity-60">No matching instances</p>
        ))}
      {!shown && expanded.has('/') && (
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
                change={changes?.ports.get(pin.name)}
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
