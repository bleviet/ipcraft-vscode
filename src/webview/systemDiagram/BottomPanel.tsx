import React, { useMemo } from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import { AddressMapTable } from './AddressMapTable';
import type { ClockAnalysis } from './clocks/analyzeClocks';
import { clocksInView } from './clocks/viewScope';
import { ClocksTable } from './ClocksTable';
import { shownLevels } from './expansion';
import { ResetsTable } from './ResetsTable';
import type { Selection } from './model';
import { UnconnectedPinsTable } from './UnconnectedPinsTable';
import type { FocusedPin, UnconnectedPin } from './unconnectedPins';

export type BottomTab = 'address' | 'clocks' | 'resets' | 'unconnected';

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
}: BottomPanelProps) {
  const view = useMemo(
    () => clocksInView(graph, clocks, shownLevels(graph, levelPath, expanded)),
    [graph, clocks, levelPath, expanded]
  );
  const tabs: { id: BottomTab; label: string; count: number }[] = [
    { id: 'address', label: 'Address map', count: graph.addressSegments.length },
    { id: 'clocks', label: 'Clocks', count: view.domains.length },
    { id: 'resets', label: 'Resets', count: view.resets.length },
    { id: 'unconnected', label: 'Unconnected', count: findings.length },
  ];
  return (
    <section
      aria-label="Bottom panel"
      className="flex min-h-0 flex-col border-t border-[var(--vscode-panel-border)]"
    >
      <div role="tablist" className="sd-ptabs flex h-[30px] shrink-0 gap-0.5 px-2.5">
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
      <div className="min-h-0 flex-1 overflow-auto px-2.5 pb-2.5">
        {tab === 'address' ? (
          <AddressMapTable graph={graph} onSelectInstance={onSelectInstance} onReveal={onReveal} />
        ) : tab === 'clocks' ? (
          <ClocksTable
            graph={graph}
            clocks={clocks}
            view={view}
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
            selection={selection}
            focusedPin={focusedPin}
            onSelectNet={onSelectNet}
            onReveal={onReveal}
          />
        ) : (
          <UnconnectedPinsTable
            graph={graph}
            findings={findings}
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
