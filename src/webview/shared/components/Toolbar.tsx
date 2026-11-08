import React from 'react';
import './toolbar.css';

/** Shared toolbar primitives of the IP core editor and the system viewer. */

interface ToolbarGroupProps {
  label: string;
  children: React.ReactNode;
}

export const ToolbarGroup: React.FC<ToolbarGroupProps> = ({ label, children }) => (
  <div className="flex flex-col items-center gap-0.5" role="group" aria-label={label}>
    {/* Fixed-height icon row so every group's label lands on the same baseline */}
    <div className="flex items-center gap-0.5" style={{ height: 28 }}>
      {children}
    </div>
    <span
      aria-hidden="true"
      style={{
        fontSize: '9px',
        opacity: 0.45,
        letterSpacing: '0.03em',
        lineHeight: 1,
        userSelect: 'none',
      }}
    >
      {label}
    </span>
  </div>
);

export const ToolbarSeparator: React.FC = () => (
  <div
    style={{
      width: '1px',
      height: '28px',
      background: 'var(--vscode-panel-border)',
      opacity: 0.6,
    }}
  />
);
