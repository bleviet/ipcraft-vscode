import React from 'react';

interface OutlineHeaderProps {
  query: string;
  onQueryChange: (value: string) => void;
  isAllExpanded: boolean;
  onToggleAll: () => void;
}

const OutlineHeader = ({
  query,
  onQueryChange,
  isAllExpanded,
  onToggleAll,
}: OutlineHeaderProps) => {
  return (
    <div className="p-3 border-b vscode-border vscode-surface flex items-center gap-2">
      <div className="relative flex-1">
        <span className="codicon codicon-search absolute left-2.5 top-2 vscode-muted text-[18px]"></span>
        <input
          className="outline-filter-input w-full pl-9 pr-3 py-1.5 text-sm rounded-md outline-none"
          placeholder="Filter registers..."
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </div>
      <button
        className="outline-filter-button ml-2 p-2 rounded flex items-center justify-center"
        title={isAllExpanded ? 'Collapse All' : 'Expand All'}
        onClick={onToggleAll}
      >
        {isAllExpanded ? (
          <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
            <rect
              x="3"
              y="3"
              width="14"
              height="14"
              rx="3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <rect x="6" y="9" width="8" height="2" rx="1" fill="currentColor" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
            <rect
              x="3"
              y="3"
              width="14"
              height="14"
              rx="3"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <rect x="6" y="9" width="8" height="2" rx="1" fill="currentColor" />
            <rect x="9" y="6" width="2" height="8" rx="1" fill="currentColor" />
          </svg>
        )}
      </button>
    </div>
  );
};

export default OutlineHeader;
