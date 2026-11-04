import React, { useRef, useState } from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import { BottomPanel, type BottomTab } from './BottomPanel';
import { DetailsPanel } from './DetailsPanel';
import { DiagramCanvas } from './DiagramCanvas';
import { DiagramToolbar, type PanelName } from './DiagramToolbar';
import { useDiagramNavigation } from './hooks/useDiagramNavigation';
import { useDiagramViewport } from './hooks/useDiagramViewport';
import { useElkLayout } from './hooks/useElkLayout';
import { usePanelResize } from './hooks/usePanelResize';
import type { DiagramProblem } from './messageState';
import { ProblemBanner } from './ProblemBanner';
import { OutlineTree } from './OutlineTree';
import { ResizeHandle } from './ResizeHandle';

interface WorkbenchLayoutProps {
  graph: SystemGraph;
  problem?: DiagramProblem;
  revealSource: (line: number) => void;
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
  const [showClockReset, setShowClockReset] = useState(false);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<BottomTab>('address');
  const { layout, error } = useElkLayout(graph, nav.levelPath, showClockReset);

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

  const fit = useDiagramViewport(
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
        showClockReset={showClockReset}
        onNavigate={nav.navigate}
        onQueryChange={setQuery}
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
              <div className="flex min-h-0 flex-col" style={{ width: panels.outline.size }}>
                <OutlineTree
                  graph={graph}
                  levelPath={nav.levelPath}
                  selection={nav.selection}
                  onSelect={nav.selectAndReveal}
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
              query={query}
              onSelect={nav.select}
              onEnterHierarchy={nav.enterHierarchy}
            />
          </main>
          {panelsVisible.details && (
            <>
              <ResizeHandle label="Resize Details" {...panels.details.separator} />
              <div className="flex min-h-0 flex-col" style={{ width: panels.details.size }}>
                <DetailsPanel
                  graph={graph}
                  selection={nav.selection}
                  onSelect={nav.selectAndReveal}
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
                onSelectInstance={nav.selectInstance}
                onReveal={revealSource}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
