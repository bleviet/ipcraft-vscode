import React from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import { AddressMapTable } from './AddressMapTable';
import { ProblemsList } from './ProblemsList';
import type { Selection } from './model';
import { UnconnectedPinsTable } from './UnconnectedPinsTable';
import type { FocusedPin, UnconnectedPin } from './unconnectedPins';

export type BottomTab = 'address' | 'unconnected' | 'problems';

interface BottomPanelProps {
  graph: SystemGraph;
  tab: BottomTab;
  onTabChange: (tab: BottomTab) => void;
  findings: readonly UnconnectedPin[];
  selection: Selection | null;
  focusedPin: FocusedPin | null;
  onSelectInstance: (instancePath: string) => void;
  onSelectPin: (finding: UnconnectedPin) => void;
  onReveal: (line: number, uri?: string) => void;
}

export function BottomPanel({
  graph,
  tab,
  onTabChange,
  findings,
  selection,
  focusedPin,
  onSelectInstance,
  onSelectPin,
  onReveal,
}: BottomPanelProps) {
  const tabs: { id: BottomTab; label: string; count: number }[] = [
    { id: 'address', label: 'Address map', count: graph.addressSegments.length },
    { id: 'unconnected', label: 'Unconnected', count: findings.length },
    { id: 'problems', label: 'Problems', count: graph.diagnostics.length },
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
        ) : tab === 'unconnected' ? (
          <UnconnectedPinsTable
            graph={graph}
            findings={findings}
            selection={selection}
            focusedPin={focusedPin}
            onSelectPin={onSelectPin}
            onShowProblems={() => onTabChange('problems')}
            onReveal={onReveal}
          />
        ) : (
          <ProblemsList graph={graph} onReveal={onReveal} />
        )}
      </div>
    </section>
  );
}
