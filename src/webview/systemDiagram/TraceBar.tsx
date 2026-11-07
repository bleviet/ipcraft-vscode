import React from 'react';

interface TraceBarProps {
  endpoints: readonly { id: string; label: string }[];
  from: string;
  to: string;
  status: string;
  noPath: boolean;
  onFromChange: (id: string) => void;
  onToChange: (id: string) => void;
  onSwap: () => void;
  onClose: () => void;
}

/** The bar under the toolbar where a path trace is set up: From and To blocks or ports of the level. */
export function TraceBar({
  endpoints,
  from,
  to,
  status,
  noPath,
  onFromChange,
  onToChange,
  onSwap,
  onClose,
}: TraceBarProps) {
  const select = (label: string, value: string, onChange: (id: string) => void) => (
    <label className="flex items-center gap-1">
      {label}
      <select
        className="sd-input"
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose...</option>
        {endpoints.map(({ id, label: name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div
      role="group"
      aria-label="Trace path"
      className="flex flex-wrap items-center gap-3 border-b border-[var(--vscode-panel-border)] px-3 py-1"
    >
      {select('From', from, onFromChange)}
      <button type="button" className="sd-tool" aria-label="Swap From and To" onClick={onSwap}>
        &#8646;
      </button>
      {select('To', to, onToChange)}
      <span
        role="status"
        className="opacity-70"
        style={noPath ? { color: 'var(--vscode-editorWarning-foreground)' } : undefined}
      >
        {status}
      </span>
      <div className="flex-1" />
      <button type="button" className="sd-tool" aria-label="Close trace" onClick={onClose}>
        &times;
      </button>
    </div>
  );
}
