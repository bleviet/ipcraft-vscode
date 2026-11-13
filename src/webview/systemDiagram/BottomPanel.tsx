import React, { useMemo, useState } from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import type { DiagramCompare } from '../../shared/messages/systemDiagram';
import { changeRows } from '../../services/systemDiagram/diff/changeRows';
import { AddressMapTable } from './AddressMapTable';
import type { ClockAnalysis } from './clocks/analyzeClocks';
import { clocksInView } from './clocks/viewScope';
import { ChangesTable } from './ChangesTable';
import { ClocksTable } from './ClocksTable';
import { shownLevels } from './expansion';
import { ResetsTable } from './ResetsTable';
import type { Selection } from './model';
import { compileSearch, DEFAULT_SEARCH_OPTIONS } from './searchMatcher';
import { UnconnectedPinsTable } from './UnconnectedPinsTable';
import type { FocusedPin, UnconnectedPin } from './unconnectedPins';

export type BottomTab = 'changes' | 'address' | 'clocks' | 'resets' | 'unconnected';

interface BottomPanelProps {
  graph: SystemGraph;
  clocks: ClockAnalysis;
  /** The level on screen, and the hierarchy blocks expanded in place on it: the Clocks and Resets tabs list what they show. */
  levelPath: string;
  expanded: ReadonlySet<string>;
  tab: BottomTab;
  onTabChange: (tab: BottomTab) => void;
  findings: readonly UnconnectedPin[];
  selection: Selection | null;
  focusedPin: FocusedPin | null;
  onSelectInstance: (instancePath: string) => void;
  onSelectPin: (finding: UnconnectedPin) => void;
  /** Opens a net of the Clocks or Resets tab; a crossing row also haloes its sink pin. */
  onSelectNet: (netId: string, focus?: { nodeId: string; pin: string }) => void;
  onReveal: (line: number, uri?: string) => void;
  /** While a comparison is on: its changes, listed in the first tab, and the way to select an external port. */
  changes?: {
    compare: DiagramCompare;
    onSelectPort: (name: string) => void;
    onSwapCompare: () => void;
  };
}

export function BottomPanel({
  graph,
  clocks,
  levelPath,
  expanded,
  tab,
  onTabChange,
  findings,
  selection,
  focusedPin,
  onSelectInstance,
  onSelectPin,
  onSelectNet,
  onReveal,
  changes,
}: BottomPanelProps) {
  const rows = useMemo(
    () => (changes ? changeRows(changes.compare.diff, { ignoreVersionOnly: false }) : []),
    [changes?.compare.diff]
  );
  const view = useMemo(
    () => clocksInView(graph, clocks, shownLevels(graph, levelPath, expanded)),
    [graph, clocks, levelPath, expanded]
  );
  const tabs: { id: BottomTab; label: string; count: number }[] = [
    ...(changes ? [{ id: 'changes' as const, label: 'Changes', count: rows.length }] : []),
    { id: 'address', label: 'Address map', count: graph.addressSegments.length },
    { id: 'clocks', label: 'Clocks', count: view.domains.length },
    { id: 'resets', label: 'Resets', count: view.resets.length },
    { id: 'unconnected', label: 'Unconnected', count: findings.length },
  ];
  // One filter box for the tab on show; each tab keeps its own text.
  const [filters, setFilters] = useState<Record<BottomTab, string>>({
    changes: '',
    address: '',
    clocks: '',
    resets: '',
    unconnected: '',
  });
  const filter = useMemo(() => compileSearch(filters[tab], DEFAULT_SEARCH_OPTIONS), [filters, tab]);
  const setFilter = (text: string) => setFilters((previous) => ({ ...previous, [tab]: text }));
  const tabLabel = tabs.find((item) => item.id === tab)?.label ?? '';
  return (
    <section
      aria-label="Bottom panel"
      className="flex min-h-0 flex-col border-t border-[var(--vscode-panel-border)]"
    >
      <div className="flex h-[30px] shrink-0 items-center gap-2 px-2.5">
        <div role="tablist" className="sd-ptabs flex h-full gap-0.5">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => onTabChange(item.id)}
            >
              {item.label}
              <span className="sr-only"> </span>
              <span className="sd-count">{item.count}</span>
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <input
          type="search"
          className="sd-input w-[220px] min-w-0 text-xs"
          placeholder={`Filter ${tabLabel.toLowerCase()}`}
          aria-label={`Filter ${tabLabel}`}
          title="Show only the rows with this text in a column. * matches any characters, ? matches one"
          value={filters[tab]}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setFilter('');
            }
          }}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2.5 pb-2.5">
        {tab === 'changes' && changes ? (
          <ChangesTable
            graph={graph}
            compare={changes.compare}
            rows={rows}
            filter={filter}
            selection={selection}
            onSelectInstance={onSelectInstance}
            onSelectPort={changes.onSelectPort}
            onSwapCompare={changes.onSwapCompare}
          />
        ) : tab === 'address' ? (
          <AddressMapTable
            graph={graph}
            filter={filter}
            onSelectInstance={onSelectInstance}
            onReveal={onReveal}
          />
        ) : tab === 'clocks' ? (
          <ClocksTable
            graph={graph}
            clocks={clocks}
            view={view}
            filter={filter}
            selection={selection}
            focusedPin={focusedPin}
            onSelectNet={onSelectNet}
            onReveal={onReveal}
          />
        ) : tab === 'resets' ? (
          <ResetsTable
            graph={graph}
            clocks={clocks}
            view={view}
            filter={filter}
            selection={selection}
            focusedPin={focusedPin}
            onSelectNet={onSelectNet}
            onReveal={onReveal}
          />
        ) : (
          <UnconnectedPinsTable
            graph={graph}
            findings={findings}
            filter={filter}
            selection={selection}
            focusedPin={focusedPin}
            onSelectPin={onSelectPin}
            onReveal={onReveal}
          />
        )}
      </div>
    </section>
  );
}
