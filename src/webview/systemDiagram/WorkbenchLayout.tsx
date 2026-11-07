import React, { useCallback, useMemo, useRef, useState } from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { HighlightColor, HighlightMap } from '../../shared/messages/systemDiagram';
import { BottomPanel, type BottomTab } from './BottomPanel';
import { analyzeClocks } from './clocks/analyzeClocks';
import { toolbarSummary } from './clocks/crossingSummary';
import { DetailsPanel } from './DetailsPanel';
import { DiagramCanvas } from './DiagramCanvas';
import { DiagramToolbar, type PanelName } from './DiagramToolbar';
import { applyHighlight, highlightCount } from './highlights';
import { useDiagramNavigation } from './hooks/useDiagramNavigation';
import { useDiagramViewport } from './hooks/useDiagramViewport';
import { useElkLayout } from './hooks/useElkLayout';
import { useIsolation } from './hooks/useIsolation';
import { useMouseBackButton } from './hooks/useMouseBackButton';
import { usePanelResize } from './hooks/usePanelResize';
import { useSearchStepper } from './hooks/useSearchStepper';
import type { DiagramProblem } from './messageState';
import { levelOf, nodeSelection, type Selection } from './model';
import { ProblemBanner } from './ProblemBanner';
import { OutlineTree } from './OutlineTree';
import { ResizeHandle } from './ResizeHandle';
import { unconnectedPins, type FocusedPin, type UnconnectedPin } from './unconnectedPins';

interface WorkbenchLayoutProps {
  graph: SystemGraph;
  highlights?: HighlightMap;
  problem?: DiagramProblem;
  revealSource: (line: number, uri?: string) => void;
  openDefinition: (instance: string) => void;
  onChangeHighlights?: (highlights: HighlightMap) => void;
}

const EMPTY_HIGHLIGHTS: HighlightMap = {};

/** Toolbar, resizable outline / canvas / details row, and bottom panel. Needs a React Flow provider. */
export function WorkbenchLayout({
  graph,
  highlights = EMPTY_HIGHLIGHTS,
  problem,
  revealSource,
  openDefinition,
  onChangeHighlights,
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
  const [domainMode, setDomainMode] = useState(false);
  // The domain mode draws clocks and resets whatever the checkbox says.
  const drawClockReset = showClockReset || domainMode;
  const [query, setQuery] = useState('');
  const view = useIsolation(graph, nav, drawClockReset);
  const { isolation } = view;
  const search = useSearchStepper(graph, query, nav.selection, view.revealMatch);
  const [tab, setTab] = useState<BottomTab>('address');
  const [reviewUnconnected, setReviewUnconnected] = useState(false);
  const [focusedPin, setFocusedPin] = useState<FocusedPin | null>(null);
  const findings = useMemo(() => unconnectedPins(graph), [graph]);
  const clocks = useMemo(() => analyzeClocks(graph), [graph]);
  const domainSummary = useMemo(() => toolbarSummary(clocks), [clocks]);
  const clockContext = useMemo(
    () => ({ graph, analysis: clocks, levelPath: nav.levelPath, domainMode }),
    [graph, clocks, nav.levelPath, domainMode]
  );
  const reviewContext = useMemo(
    () => (reviewUnconnected ? { graph, findings } : null),
    [reviewUnconnected, graph, findings]
  );
  const anyUndriven = findings.some((finding) => finding.cls === 'undriven');
  const { layout, error } = useElkLayout(
    graph,
    nav.levelPath,
    drawClockReset,
    isolation,
    nav.expanded
  );

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

  const openBottomTab = (next: BottomTab) => {
    setTab(next);
    if (panels.bottom.collapsed) {
      panels.bottom.toggle();
    }
  };
  // Zoom in to a readable size: on a large design the pin is unreadable at the fitted zoom.
  const selectFinding = (finding: UnconnectedPin) => {
    view.selectAndReveal(nodeSelection(finding.nodeId), finding.level, true);
    setFocusedPin({ nodeId: finding.nodeId, pin: finding.pin.name });
  };
  // A row of the Clocks or Resets tab with a pin (a source, or a crossing's sink) centres that
  // pin's block, zooming in when it is unreadable, and haloes the pin.
  const selectNet = (netId: string, focus?: { nodeId: string; pin: string }) => {
    if (focus) {
      view.selectAndReveal({ kind: 'net', id: netId }, undefined, true, focus.nodeId);
    } else {
      view.selectAndReveal({ kind: 'net', id: netId });
    }
    setFocusedPin(focus ? { ...focus, netId } : null);
  };

  const { fit, focusNode } = useDiagramViewport(
    layout,
    `${panelsVisible.outline}:${panelsVisible.details}:${panelsVisible.bottom}`,
    nav.revealRequest
  );

  const highlightedCount = useMemo(() => highlightCount(highlights), [highlights]);
  const handleHighlight = useCallback(
    (targets: readonly Selection[], color: HighlightColor | null) => {
      onChangeHighlights?.(applyHighlight(highlights, targets, color));
    },
    [highlights, onChangeHighlights]
  );
  const handleClearHighlights = useCallback(() => {
    onChangeHighlights?.({});
  }, [onChangeHighlights]);

  return (
    <div className="flex h-full flex-col">
      {problem && <ProblemBanner problem={problem} />}
      <DiagramToolbar
        graph={graph}
        levelPath={nav.levelPath}
        query={query}
        searchCounter={search.counter}
        showClockReset={showClockReset}
        domainMode={domainMode}
        domainSummary={domainSummary}
        reviewUnconnected={reviewUnconnected}
        unconnected={{ count: findings.length, anyUndriven }}
        isolated={isolation && { selected: isolation.selectedCount, shown: isolation.nodeIds.size }}
        onShowAll={view.showAll}
        highlightedCount={highlightedCount}
        onClearHighlights={handleClearHighlights}
        onNavigate={nav.navigate}
        onQueryChange={setQuery}
        onSearchStep={search.step}
        onShowClockResetChange={setShowClockReset}
        onDomainModeChange={(on) => {
          setDomainMode(on);
          if (on) {
            setReviewUnconnected(false);
            openBottomTab('clocks');
          }
        }}
        onReviewUnconnectedChange={(on) => {
          setReviewUnconnected(on);
          if (on) {
            setDomainMode(false);
            openBottomTab('unconnected');
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
                  review={reviewUnconnected ? findings : null}
                  clocks={domainMode ? clocks : null}
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
              selectedItems={nav.selectedItems}
              selectedNetIds={nav.selectedNetIds}
              highlights={highlights}
              isolated={isolation !== null}
              review={reviewContext}
              clocks={clockContext}
              focusedPin={focusedPin}
              query={query}
              flash={search.flash}
              onFlashEnd={search.clearFlash}
              onSelect={nav.select}
              onToggleNode={nav.toggleNode}
              onIsolate={view.isolate}
              onShowAll={view.showAll}
              onHighlight={handleHighlight}
              onClearHighlights={handleClearHighlights}
              onEnterHierarchy={nav.enterHierarchy}
              onToggleExpand={nav.toggleExpanded}
              isolatable={view.canIsolate}
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
                  clocks={clocks}
                  selection={nav.selection}
                  selectedNodeIds={nav.selectedNodeIds}
                  selectedItems={nav.selectedItems}
                  focusedPin={focusedPin}
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
                clocks={clocks}
                levelPath={nav.levelPath}
                expanded={nav.expanded}
                tab={tab}
                onTabChange={setTab}
                findings={findings}
                selection={nav.selection}
                focusedPin={focusedPin}
                onSelectInstance={view.selectInstance}
                onSelectPin={selectFinding}
                onSelectNet={selectNet}
                onReveal={revealSource}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
