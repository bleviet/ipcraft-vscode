import {
  deduplicateIssues,
  issueKey,
  type IpcraftIssue,
  type IssueSource,
} from '../../../shared/issues';
import type { CanvasAnnotations } from '../hooks/useCanvasValidation';

export interface IssueFocusRequest {
  path: readonly (string | number)[];
  nonce: number;
}

export const ISSUE_GROUPS: readonly { sources: readonly IssueSource[]; label: string }[] = [
  { sources: ['schema'], label: 'Schema' },
  { sources: ['protocol'], label: 'Protocol' },
  { sources: ['references'], label: 'References' },
  { sources: ['hdl'], label: 'HDL consistency' },
  { sources: ['hwTcl', 'componentXml'], label: 'Vendor artifact consistency' },
];

export { issueKey };

export function issueGroupLabel(source: IssueSource): string {
  return ISSUE_GROUPS.find((group) => group.sources.includes(source))?.label ?? source;
}

export function deduplicateAndOrderIssues(issues: readonly IpcraftIssue[]): IpcraftIssue[] {
  const order = new Map(
    ISSUE_GROUPS.flatMap((group, index) => group.sources.map((source) => [source, index]))
  );
  return deduplicateIssues(issues).sort(
    (left, right) => (order.get(left.source) ?? 99) - (order.get(right.source) ?? 99)
  );
}

export function elementIdsForIssue(issue: IpcraftIssue): string[] {
  const [collection, rawIndex, field, logicalPort] = issue.path;
  if (typeof rawIndex !== 'number') {
    return [];
  }
  const prefixByCollection: Record<string, string> = {
    clocks: 'clock',
    resets: 'reset',
    ports: 'port',
    busInterfaces: 'bus',
    parameters: 'parameter',
    interrupts: 'interrupt',
  };
  const prefix = prefixByCollection[String(collection)];
  if (!prefix) {
    return [];
  }
  const parentId = `${prefix}:${rawIndex}`;
  if (
    collection === 'busInterfaces' &&
    (field === 'portWidthOverrides' || field === 'portNameOverrides') &&
    typeof logicalPort === 'string'
  ) {
    return [parentId, `${parentId}:${logicalPort}`];
  }
  return [parentId];
}

export function issuesToCanvasAnnotations(issues: readonly IpcraftIssue[]): CanvasAnnotations {
  const annotations: CanvasAnnotations = {};
  for (const issue of deduplicateAndOrderIssues(issues)) {
    for (const id of elementIdsForIssue(issue)) {
      (annotations[id] ??= []).push({ severity: issue.severity, message: issue.message });
    }
  }
  return annotations;
}

export type { IpcraftIssue, IssueSource } from '../../../shared/issues';
