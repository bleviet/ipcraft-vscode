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
import { usePathTrace } from './hooks/usePathTrace';
import { useMouseBackButton } from './hooks/useMouseBackButton';
import { useBusBundling } from './hooks/useBusBundling';
import { usePinFolding } from './hooks/usePinFolding';
import { usePanelResize } from './hooks/usePanelResize';
import { useSearchStepper } from './hooks/useSearchStepper';
import type { DiagramProblem } from './messageState';
import { levelOf, nodeSelection, type Selection } from './model';
import { ProblemBanner } from './ProblemBanner';
import { TraceBar } from './TraceBar';
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
  // Clocks and resets is drawn, not laid out: no toggle moves a block.
  const [clocksOn, setClocksOn] = useState(false);
  const [query, setQuery] = useState('');
  const view = useIsolation(graph, nav);
  const { isolation } = view;
  const search = useSearchStepper(graph, query, nav.selection, view.revealMatch);
  const [tab, setTab] = useState<BottomTab>('address');
  const [reviewUnconnected, setReviewUnconnected] = useState(false);
  const [focusedPin, setFocusedPin] = useState<FocusedPin | null>(null);
  const findings = useMemo(() => unconnectedPins(graph), [graph]);
  const clocks = useMemo(() => analyzeClocks(graph), [graph]);
  const clockSummary = useMemo(() => toolbarSummary(clocks), [clocks]);
  // The review pauses the domain decorations, not the clock and reset wires.
  const domainsShown = clocksOn && !reviewUnconnected;
  const clockContext = useMemo(
    () => ({ graph, analysis: clocks, levelPath: nav.levelPath, domainMode: domainsShown }),
    [graph, clocks, nav.levelPath, domainsShown]
  );
  const reviewContext = useMemo(
    () => (reviewUnconnected ? { graph, findings } : null),
    [reviewUnconnected, graph, findings]
  );
  const anyUndriven = findings.some((finding) => finding.cls === 'undriven');
  // Compact pins is a layout input: folding a pin array re-runs the layout.
  const pins = usePinFolding();
  // Bundle buses is a layout input too: fewer wires, so a different routing.
  const buses = useBusBundling();
  const { layout, error } = useElkLayout(
    graph,
    nav.levelPath,
    isolation,
    nav.expanded,
    pins.folding,
    buses.busBundling
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
  const tracer = usePathTrace(
    graph,
    nav.levelPath,
    { trace: view.trace, endTrace: view.endTrace, shownTrace: isolation?.trace },
    () => openBottomTab('path')
  );
  const showAll = () => {
    view.showAll();
    tracer.close();
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
        clocksOn={clocksOn}
        clockSummary={clockSummary}
        reviewUnconnected={reviewUnconnected}
        compactPins={pins.compact}
        bundleBuses={buses.on}
        unconnected={{ count: findings.length, anyUndriven }}
        isolated={isolation}
        traceOpen={tracer.open}
        onShowAll={showAll}
        onSetHops={view.setHops}
        onToggleTrace={tracer.toggle}
        highlightedCount={highlightedCount}
        onClearHighlights={handleClearHighlights}
        onNavigate={nav.navigate}
        onQueryChange={setQuery}
        onSearchStep={search.step}
        onClocksChange={setClocksOn}
        onCompactPinsChange={pins.setCompact}
        onBundleBusesChange={buses.setOn}
        onOpenClocksTab={() => openBottomTab('clocks')}
        onReviewUnconnectedChange={(on) => {
          setReviewUnconnected(on);
          if (on) {
            openBottomTab('unconnected');
          }
        }}
        onFit={fit}
        panelsVisible={panelsVisible}
        onTogglePanel={(panel) => panels[panel].toggle()}
      />
      {tracer.open && (
        <TraceBar
          endpoints={tracer.endpoints}
          from={tracer.from}
          to={tracer.to}
          status={tracer.status}
          noPath={tracer.noPath}
          onFromChange={tracer.setFrom}
          onToChange={tracer.setTo}
          onSwap={tracer.swap}
          onClose={tracer.close}
        />
      )}
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
                  clocks={domainsShown ? clocks : null}
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
              drawClockReset={clocksOn}
              focusedPin={focusedPin}
              query={query}
              flash={search.flash}
              onFlashEnd={search.clearFlash}
              onSelect={nav.select}
              onToggleNode={nav.toggleNode}
              onSelectItems={nav.selectItems}
              onToggleItems={nav.toggleItems}
              onUnbundle={buses.unbundle}
              onIsolate={view.isolate}
              onTraceFrom={tracer.setFrom}
              onTraceTo={tracer.setTo}
              onShowAll={showAll}
              onHighlight={handleHighlight}
              onClearHighlights={handleClearHighlights}
              onEnterHierarchy={nav.enterHierarchy}
              onToggleExpand={nav.toggleExpanded}
              onTogglePinGroup={pins.togglePinGroup}
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
                  edges={layout?.edges}
                  activeBundleKey={nav.activeBundleKey}
                  isolatable={view.canIsolate}
                  onSelect={view.selectAndReveal}
                  onEnterHierarchy={nav.enterHierarchy}
                  onUnbundle={buses.unbundle}
                  onIsolate={view.isolate}
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
                trace={isolation?.trace}
                onSelectNets={(netIds) =>
                  nav.selectItems(netIds.map((id) => ({ kind: 'net' as const, id })))
                }
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
