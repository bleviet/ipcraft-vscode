import React from 'react';
import { useReactFlow } from '@xyflow/react';
import type { SystemGraph } from '../../domain/systemGraph';
import { breadcrumbs } from './model';

interface DiagramToolbarProps {
  graph: SystemGraph;
  levelPath: string;
  query: string;
  showClockReset: boolean;
  onNavigate: (levelPath: string) => void;
  onQueryChange: (query: string) => void;
  onShowClockResetChange: (show: boolean) => void;
  onOpenProblems: () => void;
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

function completenessLabel(graph: SystemGraph): string | null {
  const warnings = graph.diagnostics.filter((d) => d.severity === 'warning').length;
  const partial = Object.values(graph.capabilities).some((state) => state !== 'complete');
  if (!partial && warnings === 0) {
    return null;
  }
  return `Offline view, partial · ${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`;
}

export function DiagramToolbar({
  graph,
  levelPath,
  query,
  showClockReset,
  onNavigate,
  onQueryChange,
  onShowClockResetChange,
  onOpenProblems,
  onFit,
  panelsVisible,
  onTogglePanel,
}: DiagramToolbarProps) {
  const { zoomIn, zoomOut } = useReactFlow();
  const crumbs = breadcrumbs(levelPath, graph.name);
  const badge = completenessLabel(graph);
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-[var(--vscode-panel-border)] px-3 py-1">
      <nav aria-label="Hierarchy" className="flex items-center gap-1">
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
      <input
        type="search"
        className="sd-input"
        placeholder="Search instances"
        aria-label="Search instances"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <label className="flex items-center gap-1">
        <input
          type="checkbox"
          checked={showClockReset}
          onChange={(event) => onShowClockResetChange(event.target.checked)}
        />
        Clocks and resets
      </label>
      <div className="flex gap-1">
        <button type="button" className="sd-button" onClick={onFit}>
          Fit
        </button>
        <button
          type="button"
          className="sd-button"
          aria-label="Zoom in"
          onClick={() => void zoomIn()}
        >
          +
        </button>
        <button
          type="button"
          className="sd-button"
          aria-label="Zoom out"
          onClick={() => void zoomOut()}
        >
          -
        </button>
      </div>
      <div className="ml-auto flex items-center gap-3">
        {badge && (
          <button type="button" className="sd-link" onClick={onOpenProblems}>
            {badge}
          </button>
        )}
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
    </div>
  );
}
