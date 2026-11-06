import React, { useCallback, useRef, useState } from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import { BottomPanel, type BottomTab } from './BottomPanel';
import { DetailsPanel } from './DetailsPanel';
import { DiagramCanvas } from './DiagramCanvas';
import { DiagramToolbar, type PanelName } from './DiagramToolbar';
import { useDiagramNavigation } from './hooks/useDiagramNavigation';
import { useDiagramViewport } from './hooks/useDiagramViewport';
import { useElkLayout } from './hooks/useElkLayout';
import { useIsolation } from './hooks/useIsolation';
import { useMouseBackButton } from './hooks/useMouseBackButton';
import { usePanelResize } from './hooks/usePanelResize';
import { useSearchStepper } from './hooks/useSearchStepper';
import type { DiagramProblem } from './messageState';
import { levelOf } from './model';
import { ProblemBanner } from './ProblemBanner';
import { OutlineTree } from './OutlineTree';
import { ResizeHandle } from './ResizeHandle';

interface WorkbenchLayoutProps {
  graph: SystemGraph;
  problem?: DiagramProblem;
  revealSource: (line: number, uri?: string) => void;
  openDefinition: (instance: string) => void;
}

/** Toolbar, resizable outline / canvas / details row, and bottom panel. Needs a React Flow provider. */
export function WorkbenchLayout({
  graph,
  problem,
  revealSource,
  openDefinition,
}: WorkbenchLayoutProps) {
  const nav = useDiagramNavigation(graph);
  const { levelPath, navigate } = nav;
  useMouseBackButton(
    useCallback(() => {
      if (levelPath !== '/') {
        navigate(levelOf(levelPath));
      }
    }, [levelPath, navigate])
  );
  const [showClockReset, setShowClockReset] = useState(false);
  const [query, setQuery] = useState('');
  const view = useIsolation(graph, nav, showClockReset);
  const { isolation } = view;
  const search = useSearchStepper(graph, query, nav.selection, view.revealMatch);
  const [tab, setTab] = useState<BottomTab>('address');
  const { layout, error } = useElkLayout(graph, nav.levelPath, showClockReset, isolation);

  const bodyRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const panels = {
    outline: usePanelResize('left', rowRef),
    details: usePanelResize('right', rowRef),
    bottom: usePanelResize('bottom', bodyRef),
  };
  const panelsVisible: Record<PanelName, boolean> = {
    outline: !panels.outline.collapsed,
    details: !panels.details.collapsed,
    bottom: !panels.bottom.collapsed,
  };

  const { fit, focusNode } = useDiagramViewport(
    layout,
    `${panelsVisible.outline}:${panelsVisible.details}:${panelsVisible.bottom}`,
    nav.revealRequest
  );

  return (
    <div className="flex h-full flex-col">
      {problem && <ProblemBanner problem={problem} />}
      <DiagramToolbar
        graph={graph}
        levelPath={nav.levelPath}
        query={query}
        searchCounter={search.counter}
        showClockReset={showClockReset}
        isolated={isolation && { selected: isolation.selectedCount, shown: isolation.nodeIds.size }}
        onShowAll={view.showAll}
        onNavigate={nav.navigate}
        onQueryChange={setQuery}
        onSearchStep={search.step}
        onShowClockResetChange={setShowClockReset}
        onOpenProblems={() => {
          setTab('problems');
          if (panels.bottom.collapsed) {
            panels.bottom.toggle();
          }
        }}
        onFit={fit}
        panelsVisible={panelsVisible}
        onTogglePanel={(panel) => panels[panel].toggle()}
      />
      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
        <div ref={rowRef} className="flex min-h-0 flex-1">
          {panelsVisible.outline && (
            <>
              <div
                className="sd-side sd-side-left flex min-h-0 flex-col"
                style={{ width: panels.outline.size }}
              >
                <OutlineTree
                  graph={graph}
                  levelPath={nav.levelPath}
                  selection={nav.selection}
                  onSelect={view.selectAndReveal}
                />
              </div>
              <ResizeHandle label="Resize Outline" {...panels.outline.separator} />
            </>
          )}
          <main className="min-w-0 flex-1">
            <DiagramCanvas
              layout={layout}
              error={error}
              selection={nav.selection}
              selectedNodeIds={nav.selectedNodeIds}
              isolated={isolation !== null}
              query={query}
              flash={search.flash}
              onFlashEnd={search.clearFlash}
              onSelect={nav.select}
              onToggleNode={nav.toggleNode}
              onIsolate={view.isolate}
              onShowAll={view.showAll}
              onEnterHierarchy={nav.enterHierarchy}
              onFocusNode={focusNode}
              onFit={fit}
            />
          </main>
          {panelsVisible.details && (
            <>
              <ResizeHandle label="Resize Details" {...panels.details.separator} />
              <div
                className="sd-side sd-side-right flex min-h-0 flex-col"
                style={{ width: panels.details.size }}
              >
                <DetailsPanel
                  graph={graph}
                  selection={nav.selection}
                  selectedNodeIds={nav.selectedNodeIds}
                  onSelect={view.selectAndReveal}
                  onEnterHierarchy={nav.enterHierarchy}
                  onReveal={revealSource}
                  onOpenDefinition={openDefinition}
                />
              </div>
            </>
          )}
        </div>
        {panelsVisible.bottom && (
          <>
            <ResizeHandle label="Resize Bottom Panel" {...panels.bottom.separator} />
            <div className="flex min-h-0 flex-col" style={{ height: panels.bottom.size }}>
              <BottomPanel
                graph={graph}
                tab={tab}
                onTabChange={setTab}
                onSelectInstance={view.selectInstance}
                onReveal={revealSource}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
