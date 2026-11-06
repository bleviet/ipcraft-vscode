import React from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import { AddressMapTable } from './AddressMapTable';
import { ProblemsList } from './ProblemsList';

export type BottomTab = 'address' | 'problems';

interface BottomPanelProps {
  graph: SystemGraph;
  tab: BottomTab;
  onTabChange: (tab: BottomTab) => void;
  onSelectInstance: (instancePath: string) => void;
  onReveal: (line: number, uri?: string) => void;
}

export function BottomPanel({
  graph,
  tab,
  onTabChange,
  onSelectInstance,
  onReveal,
}: BottomPanelProps) {
  const tabs: { id: BottomTab; label: string; count: number }[] = [
    { id: 'address', label: 'Address map', count: graph.addressSegments.length },
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
        ) : (
          <ProblemsList graph={graph} onReveal={onReveal} />
        )}
      </div>
    </section>
  );
}
