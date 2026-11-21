import React, { useMemo } from 'react';
import type { IpcraftIssue } from '../../../../shared/issues';
import { deduplicateAndOrderIssues, issueGroupLabel, issueKey } from '../../types/issues';
import { useInspectorWidth } from './inspector/useInspectorWidth';

interface IssuesPanelProps {
  issues: readonly IpcraftIssue[];
  onSelect: (issue: IpcraftIssue) => void;
  onClose: () => void;
}

export const IssuesPanel: React.FC<IssuesPanelProps> = ({ issues, onSelect, onClose }) => {
  const { panelWidth, handleResizeMouseDown } = useInspectorWidth();
  const groups = useMemo(() => {
    const result = new Map<string, IpcraftIssue[]>();
    for (const issue of deduplicateAndOrderIssues(issues)) {
      const label = issueGroupLabel(issue.source);
      const group = result.get(label) ?? [];
      group.push(issue);
      result.set(label, group);
    }
    return result;
  }, [issues]);

  return (
    <aside
      className="canvas-inspector issues-panel"
      aria-label="Issues"
      style={{ width: panelWidth }}
    >
      <div className="ci-resize-handle" onMouseDown={handleResizeMouseDown} />
      <div className="ci-header">
        <div className="ci-header__info">
          <span className="ci-badge">Issues</span>
          <div className="ci-header__name">{issues.length} total</div>
        </div>
        <button className="ci-header__close" onClick={onClose} title="Close issues">
          <span className="codicon codicon-close" />
        </button>
      </div>
      <div className="ci-body">
        {groups.size === 0 && <div className="ci-override-empty">No issues</div>}
        {[...groups.entries()].map(([label, groupIssues]) => (
          <section className="ci-section" key={label}>
            <div className="ci-section__title">
              <span>{label}</span>
            </div>
            {groupIssues.map((issue) => (
              <button
                type="button"
                key={issueKey(issue)}
                className="ci-busmatrix-row issues-panel__row"
                onClick={() => onSelect(issue)}
                style={{ width: '100%', textAlign: 'left' }}
              >
                <span
                  className={`codicon codicon-${issue.severity === 'error' ? 'error' : 'warning'}`}
                  aria-label={issue.severity}
                />
                <span className="issues-panel__message">{issue.message}</span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </aside>
  );
};
