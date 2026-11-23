import React from 'react';
import type { VersionRefIssue } from '../../../shared/versioning/validateVersionRefs';

/**
 * Compact list of `$version` diagnostics. Errors use the shared error style, warnings the theme's
 * warning colour. Renders nothing when there are no issues.
 */
export function VersionIssueList({
  issues,
  className = '',
}: {
  issues: readonly VersionRefIssue[] | undefined;
  className?: string;
}) {
  if (!issues || issues.length === 0) {
    return null;
  }
  return (
    <ul className={`text-xs list-none m-0 p-0 ${className}`} data-testid="version-issues">
      {issues.map((issue, index) => (
        <li
          key={`${issue.severity}-${index}`}
          className={issue.severity === 'error' ? 'vscode-error' : undefined}
          style={
            issue.severity === 'warning'
              ? { color: 'var(--vscode-editorWarning-foreground, #cca700)' }
              : undefined
          }
          data-severity={issue.severity}
        >
          {issue.message}
        </li>
      ))}
    </ul>
  );
}
