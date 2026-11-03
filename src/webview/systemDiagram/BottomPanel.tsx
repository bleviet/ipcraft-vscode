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
  onReveal: (line: number) => void;
}

export function BottomPanel({
  graph,
  tab,
  onTabChange,
  onSelectInstance,
  onReveal,
}: BottomPanelProps) {
  const tabs: { id: BottomTab; label: string }[] = [
    { id: 'address', label: `Address map (${graph.addressSegments.length})` },
    { id: 'problems', label: `Problems (${graph.diagnostics.length})` },
  ];
  return (
    <section
      aria-label="Bottom panel"
      className="flex min-h-0 flex-col border-t border-[var(--vscode-panel-border)]"
    >
      <div role="tablist" className="flex gap-3 px-3 py-1">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'font-semibold underline' : 'opacity-70'}
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'address' ? (
          <AddressMapTable graph={graph} onSelectInstance={onSelectInstance} onReveal={onReveal} />
        ) : (
          <ProblemsList graph={graph} onReveal={onReveal} />
        )}
      </div>
    </section>
  );
}
