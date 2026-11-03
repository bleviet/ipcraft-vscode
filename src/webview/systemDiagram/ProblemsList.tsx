import React from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import { LineLink } from './LineLink';

export function ProblemsList({
  graph,
  onReveal,
}: {
  graph: SystemGraph;
  onReveal: (line: number) => void;
}) {
  if (graph.diagnostics.length === 0) {
    return <p className="p-3 opacity-70">No problems found.</p>;
  }
  return (
    <ul>
      {graph.diagnostics.map((diagnostic) => (
        <li key={`${diagnostic.severity}:${diagnostic.message}`} className="sd-row px-3 py-1">
          <span
            className={`codicon codicon-${diagnostic.severity === 'warning' ? 'warning' : 'info'} mr-2`}
            aria-label={diagnostic.severity}
            style={{
              color:
                diagnostic.severity === 'warning'
                  ? 'var(--vscode-editorWarning-foreground)'
                  : 'var(--vscode-editorInfo-foreground)',
            }}
          />
          {diagnostic.message}
          {(diagnostic.lines ?? []).map((line) => (
            <React.Fragment key={line}>
              {' '}
              <LineLink fileName={graph.source.fileName} line={line} onReveal={onReveal} />
            </React.Fragment>
          ))}
        </li>
      ))}
    </ul>
  );
}
