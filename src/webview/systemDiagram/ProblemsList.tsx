import React from 'react';
import type { SystemGraph } from '../../domain/systemGraph';
import { LineLink } from './LineLink';
import { levelSource } from './sourceFile';

export function ProblemsList({
  graph,
  onReveal,
}: {
  graph: SystemGraph;
  onReveal: (line: number, uri?: string) => void;
}) {
  if (graph.diagnostics.length === 0) {
    return <p className="p-3 opacity-70">No problems found.</p>;
  }
  return (
    <ul>
      {graph.diagnostics.map((diagnostic) => (
        <li
          key={`${diagnostic.level ?? '/'}:${diagnostic.severity}:${diagnostic.message}`}
          className="sd-prob"
        >
          <span
            className={`codicon codicon-${diagnostic.severity === 'warning' ? 'warning' : 'info'} shrink-0`}
            aria-label={diagnostic.severity}
            style={{
              color:
                diagnostic.severity === 'warning'
                  ? 'var(--vscode-editorWarning-foreground)'
                  : 'var(--vscode-editorInfo-foreground)',
            }}
          />
          <span className="min-w-0 flex-1">
            {diagnostic.message}
            {(diagnostic.lines ?? []).map((line) => (
              <React.Fragment key={line}>
                {' '}
                <LineLink
                  source={levelSource(graph, diagnostic.level ?? '/')}
                  line={line}
                  onReveal={onReveal}
                />
              </React.Fragment>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}
