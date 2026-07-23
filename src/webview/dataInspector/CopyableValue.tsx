import React from 'react';
import type { ValueRepresentation } from '../../dataInspector/formatValue';

interface CopyableValueProps {
  label: string;
  value: string;
  representation?: ValueRepresentation;
}

export function CopyableValue({ label, value, representation }: CopyableValueProps) {
  return (
    <div className="di-copyable-value">
      <div className="di-copyable-value__heading">
        <span>{label}</span>
        {representation && <small>{representation}</small>}
      </div>
      <div className="di-copyable-value__content">
        <code className={label === 'Value' ? 'di-inspector-value' : undefined}>{value}</code>
        <button
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => void navigator.clipboard.writeText(value)}
          data-tooltip={`Copy ${label.toLowerCase()}`}
          type="button"
        >
          <span className="codicon codicon-copy" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
