export type IssueSource = 'schema' | 'protocol' | 'references' | 'hdl' | 'hwTcl' | 'componentXml';

export interface IpcraftIssue {
  code: string;
  severity: 'error' | 'warning';
  source: IssueSource;
  path: readonly (string | number)[];
  message: string;
  interfaceName?: string;
}

export interface ConformanceReport {
  issues: readonly IpcraftIssue[];
  hasKnownErrors: boolean;
  hasUnresolved: boolean;
}

export const issueKey = (issue: IpcraftIssue): string =>
  `${issue.source}|${issue.code}|${JSON.stringify(issue.path)}`;

export function deduplicateIssues(issues: readonly IpcraftIssue[]): IpcraftIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = issueKey(issue);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
