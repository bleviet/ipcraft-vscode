import React from 'react';
import { useReactFlow } from '@xyflow/react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { ToolbarSummary } from './clocks/crossingSummary';
import { ToolbarGroup, ToolbarSeparator } from '../shared/components/Toolbar';
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
  /** Simplify zoomed out is on: far out, pin text goes and block names grow (drawing only). */
  autoDetail: boolean;
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
  /** Up (-1) or Down (1) in the search box: show an older or newer search; true when the query changed. */
  onSearchHistory: (direction: -1 | 1) => boolean;
  /** The search box lost focus: remember its query. */
  onSearchBlur: () => void;
  onClocksChange: (on: boolean) => void;
  onOpenClocksTab: () => void;
  onReviewUnconnectedChange: (on: boolean) => void;
  onAutoDetailChange: (on: boolean) => void;
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
  autoDetail,
  unconnected,
  isolated,
  onShowAll,
  highlightedCount,
  onClearHighlights,
  onNavigate,
  onQueryChange,
  onSearchStep,
  onSearchHistory,
  onSearchBlur,
  onClocksChange,
  onOpenClocksTab,
  onReviewUnconnectedChange,
  onAutoDetailChange,
  onFit,
  panelsVisible,
  onTogglePanel,
}: DiagramToolbarProps) {
  const { zoomIn, zoomOut } = useReactFlow();
  const crumbs = breadcrumbs(levelPath, graph.name);
  return (
    <div className="flex flex-wrap items-start gap-3 border-b border-[var(--vscode-panel-border)] bg-[var(--vscode-sideBar-background)] px-4 py-2">
      {/* minHeight matches the 28px icon row of ToolbarGroup so these items centre on it */}
      <div
        className="flex min-w-0 flex-auto flex-wrap items-center gap-3"
        style={{ minHeight: 28 }}
      >
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
          placeholder="Search instances (⇅ for history)"
          aria-label="Search instances"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onBlur={onSearchBlur}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              if (
                event.altKey ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey ||
                event.nativeEvent.isComposing
              ) {
                return;
              }
              if (onSearchHistory(event.key === 'ArrowUp' ? -1 : 1)) {
                event.preventDefault();
              }
            } else if (event.key === 'Enter') {
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
      </div>
      <ToolbarSeparator />
      <ToolbarGroup label="Design">
        <span className="sd-tool-group">
          <button
            type="button"
            className={`canvas-view-toggle${clocksOn ? ' canvas-view-toggle--active' : ''}`}
            aria-pressed={clocksOn}
            aria-label="Clocks and resets"
            title="Clocks and resets: color clock and reset pins by domain, with frequencies and clock domain crossings"
            onClick={() => onClocksChange(!clocksOn)}
          >
            <span aria-hidden="true" className="codicon codicon-pulse" />
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
          className={`canvas-view-toggle${reviewUnconnected ? ' canvas-view-toggle--active' : ''}`}
          aria-pressed={reviewUnconnected}
          aria-label={`Unconnected pins ${unconnected.count}`}
          title="Unconnected pins: highlight unconnected pins on the diagram and list them"
          onClick={() => onReviewUnconnectedChange(!reviewUnconnected)}
        >
          <span aria-hidden="true" className="codicon codicon-debug-disconnect" />
          <span
            className="sd-tool-count"
            data-tone={unconnected.anyUndriven ? 'undriven' : 'unused'}
          >
            {unconnected.count}
          </span>
        </button>
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup label="View">
        <button
          type="button"
          className={`canvas-view-toggle${autoDetail ? ' canvas-view-toggle--active' : ''}`}
          aria-pressed={autoDetail}
          aria-label="Simplify zoomed out"
          title="Simplify zoomed out: when zoomed out, hide pin names and enlarge block names so the blocks stay readable. Blocks never move"
          onClick={() => onAutoDetailChange(!autoDetail)}
        >
          <span aria-hidden="true" className="codicon codicon-text-size" />
        </button>
        <button
          type="button"
          className="canvas-view-toggle"
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => void zoomOut()}
        >
          <span aria-hidden="true" className="codicon codicon-zoom-out" />
        </button>
        <button
          type="button"
          className="canvas-view-toggle"
          aria-label="Fit"
          title="Fit the level"
          onClick={onFit}
        >
          <span aria-hidden="true" className="codicon codicon-screen-full" />
        </button>
        <button
          type="button"
          className="canvas-view-toggle"
          aria-label="Zoom in"
          title="Zoom in"
          onClick={() => void zoomIn()}
        >
          <span aria-hidden="true" className="codicon codicon-zoom-in" />
        </button>
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup label="Panels">
        {PANEL_TOGGLES.map(({ panel, title, icon }) => {
          const visible = panelsVisible[panel];
          return (
            <button
              key={panel}
              type="button"
              className={`canvas-view-toggle${visible ? ' canvas-view-toggle--active' : ''}`}
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
      </ToolbarGroup>
    </div>
  );
}
