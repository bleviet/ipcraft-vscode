import React from 'react';
import { useReactFlow } from '@xyflow/react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { ToolbarSummary } from './clocks/crossingSummary';
import { breadcrumbs } from './model';

interface DiagramToolbarProps {
  graph: SystemGraph;
  levelPath: string;
  query: string;
  /** The Search instances box, which Ctrl/Cmd+F focuses. */
  searchInputRef: React.Ref<HTMLInputElement>;
  searchCounter: string;
  /** Clocks and resets is on: the clock and reset pins are colored by domain, with the domain decorations. */
  clocksOn: boolean;
  /** The count chip next to the Clocks and resets toggle: the crossings, else the number of domains. */
  clockSummary: ToolbarSummary;
  reviewUnconnected: boolean;
  /** Number of unconnected pins in the design, and whether any is undriven. */
  unconnected: { count: number; anyUndriven: boolean };
  /** Selected and shown node counts while the level is isolated, else null. */
  isolated: { selected: number; shown: number } | null;
  onShowAll: () => void;
  highlightedCount?: number;
  onClearHighlights?: () => void;
  onNavigate: (levelPath: string) => void;
  onQueryChange: (query: string) => void;
  onSearchStep: (direction: 1 | -1) => void;
  onClocksChange: (on: boolean) => void;
  onOpenClocksTab: () => void;
  onReviewUnconnectedChange: (on: boolean) => void;
  onFit: () => void;
  panelsVisible: Record<PanelName, boolean>;
  onTogglePanel: (panel: PanelName) => void;
}

export type PanelName = 'outline' | 'bottom' | 'details';

const PANEL_TOGGLES: { panel: PanelName; title: string; icon: string }[] = [
  { panel: 'outline', title: 'Toggle Outline', icon: 'layout-sidebar-left' },
  { panel: 'bottom', title: 'Toggle Bottom Panel', icon: 'layout-panel' },
  { panel: 'details', title: 'Toggle Details', icon: 'layout-sidebar-right' },
];

export function DiagramToolbar({
  graph,
  levelPath,
  query,
  searchInputRef,
  searchCounter,
  clocksOn,
  clockSummary,
  reviewUnconnected,
  unconnected,
  isolated,
  onShowAll,
  highlightedCount,
  onClearHighlights,
  onNavigate,
  onQueryChange,
  onSearchStep,
  onClocksChange,
  onOpenClocksTab,
  onReviewUnconnectedChange,
  onFit,
  panelsVisible,
  onTogglePanel,
}: DiagramToolbarProps) {
  const { zoomIn, zoomOut } = useReactFlow();
  const crumbs = breadcrumbs(levelPath, graph.name);
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--vscode-panel-border)] px-3 py-1">
      <nav aria-label="Hierarchy" className="flex min-w-0 items-center gap-1 whitespace-nowrap">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <React.Fragment key={crumb.path}>
              {index > 0 && <span aria-hidden="true">/</span>}
              {last ? (
                <span aria-current="page" className="font-semibold">
                  {crumb.label}
                </span>
              ) : (
                <button type="button" className="sd-link" onClick={() => onNavigate(crumb.path)}>
                  {crumb.label}
                </button>
              )}
            </React.Fragment>
          );
        })}
      </nav>
      {isolated && (
        <span className="sd-isolated">
          <span>
            Isolated · {isolated.selected} selected · {isolated.shown} shown
          </span>
          <button type="button" className="sd-tool" onClick={onShowAll}>
            Show All
          </button>
        </span>
      )}
      {highlightedCount !== undefined && highlightedCount > 0 && (
        <span className="sd-isolated">
          <span>Highlighted · {highlightedCount}</span>
          <button type="button" className="sd-tool" onClick={onClearHighlights}>
            Clear All
          </button>
        </span>
      )}
      <div className="flex-1" />
      <input
        ref={searchInputRef}
        type="search"
        className="sd-input w-[220px] min-w-0"
        placeholder="Search instances"
        aria-label="Search instances"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            if (event.nativeEvent.isComposing) {
              return;
            }
            event.preventDefault();
            onSearchStep(event.shiftKey ? -1 : 1);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onQueryChange('');
            event.currentTarget.blur();
          }
        }}
      />
      {query.trim() !== '' && (
        <span aria-live="polite" className="opacity-70">
          {searchCounter}
        </span>
      )}
      <span className="sd-tool-group">
        <button
          type="button"
          className="sd-tool"
          aria-pressed={clocksOn}
          title="Color clock and reset pins by domain, with frequencies and clock domain crossings"
          onClick={() => onClocksChange(!clocksOn)}
        >
          Clocks and resets
        </button>
        <button
          type="button"
          className="sd-tool-count"
          data-tone={clockSummary.warning ? 'warning' : 'info'}
          aria-label={`Open the Clocks tab: ${clockSummary.label}`}
          title="Open the Clocks tab"
          onClick={onOpenClocksTab}
        >
          {clockSummary.text}
        </button>
      </span>
      <button
        type="button"
        className="sd-tool"
        aria-pressed={reviewUnconnected}
        title="Highlight unconnected pins on the diagram and list them"
        onClick={() => onReviewUnconnectedChange(!reviewUnconnected)}
      >
        Unconnected pins{' '}
        <span className="sd-tool-count" data-tone={unconnected.anyUndriven ? 'undriven' : 'unused'}>
          {unconnected.count}
        </span>
      </button>
      <div className="flex gap-1">
        <button
          type="button"
          className="sd-tool"
          aria-label="Zoom out"
          onClick={() => void zoomOut()}
        >
          &minus;
        </button>
        <button type="button" className="sd-tool" onClick={onFit}>
          Fit
        </button>
        <button
          type="button"
          className="sd-tool"
          aria-label="Zoom in"
          onClick={() => void zoomIn()}
        >
          +
        </button>
      </div>
      <div className="flex gap-1">
        {PANEL_TOGGLES.map(({ panel, title, icon }) => {
          const visible = panelsVisible[panel];
          return (
            <button
              key={panel}
              type="button"
              className="sd-icon-button"
              title={title}
              aria-label={title}
              aria-pressed={visible}
              onClick={() => onTogglePanel(panel)}
            >
              <span
                className={`codicon codicon-${icon}${visible || panel === 'bottom' ? '' : '-off'}`}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
