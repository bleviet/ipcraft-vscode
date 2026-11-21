import { useCallback, useMemo, useState } from 'react';
import { vscode } from '../../vscode';
import {
  isAmbiguousFinding,
  type ConsistencyFinding,
  type ConsistencySummary,
} from '../types/consistency';
import type { IpcraftIssue } from '../../../shared/issues';

export interface ConsistencyResultMessage {
  auto?: boolean;
  error?: string;
  findings?: ConsistencyFinding[];
  issues?: IpcraftIssue[];
  summary?: ConsistencySummary;
}

export interface ConsistencyBadge {
  label: string;
  color: string;
  title: string;
}

/**
 * Consistency-check session (issue #84): request/response state, the toolbar
 * badge, and the request to reveal the Issues panel after a manual check that
 * finds something. The findings themselves are listed by the Issues panel.
 * Extracted from IpCoreApp (issue #129).
 */
export function useConsistencySession(opts: { showToast: (message: string) => void }) {
  const { showToast } = opts;

  // Result of the last completed run, and a counter of the manual checks that found something.
  const [consistencyResult, setConsistencyResult] = useState<{
    findings: ConsistencyFinding[];
    issues: IpcraftIssue[];
    summary: ConsistencySummary;
  } | null>(null);
  const [consistencyChecking, setConsistencyChecking] = useState(false);
  const [findingsRevealRequest, setFindingsRevealRequest] = useState(0);

  const handleCheckConsistency = useCallback(() => {
    setConsistencyChecking(true);
    vscode?.postMessage({ type: 'checkConsistency' });
  }, []);

  // Background checks (issue #84) run silently: update the badge, but never surface an
  // error toast or open the Issues panel uninvited — only a manual check does that.
  const handleConsistencyResultMessage = useCallback(
    (message: ConsistencyResultMessage) => {
      const isAutoCheck = message.auto === true;
      if (!isAutoCheck) {
        setConsistencyChecking(false);
      }
      if (message.error) {
        if (!isAutoCheck) {
          showToast(`Consistency check failed: ${message.error}`);
        }
        return;
      }
      setConsistencyResult({
        findings: message.findings ?? [],
        issues: message.issues ?? [],
        summary: message.summary ?? { added: 0, removed: 0, changed: 0, ambiguous: 0 },
      });
      if (!isAutoCheck) {
        if ((message.findings ?? []).length > 0) {
          setFindingsRevealRequest((request) => request + 1);
        } else {
          showToast('IPCraft: consistent with every checked implementation source.');
        }
      }
    },
    [showToast]
  );

  const consistencyBadge = useMemo((): ConsistencyBadge => {
    if (consistencyChecking) {
      return {
        label: 'Checking…',
        color: 'var(--vscode-descriptionForeground)',
        title: 'Consistency check running',
      };
    }
    if (!consistencyResult) {
      return {
        label: 'Not checked',
        color: 'var(--vscode-descriptionForeground)',
        title: 'Click Check Consistency to compare against HDL/vendor artifacts',
      };
    }
    const { findings } = consistencyResult;
    if (findings.length === 0) {
      return {
        label: 'Consistent',
        color: 'var(--vscode-charts-green, #3aaa5c)',
        title: 'Consistent with every checked implementation source',
      };
    }
    // An ambiguity finding means the checker couldn't identify what to diff at all — it isn't
    // evidence of drift (issue #161), so it must not read as one. Only label as "Drift" once at
    // least one visible finding is an actual comparison result.
    if (findings.every(isAmbiguousFinding)) {
      return {
        label: 'Ambiguous',
        color: 'var(--vscode-descriptionForeground)',
        title:
          `${findings.length} finding(s) — the top-level HDL implementation could not ` +
          `be uniquely identified — click to review`,
      };
    }
    // "Conflict" vs "Drift" read as two different problems when they're really the same one
    // (the .ip.yml disagrees with what's on disk) — issue #92. One label, "Drift", for any
    // non-empty result; the dot color still carries the reconcilable/destructive distinction.
    if (findings.some((f) => f.severity === 'red')) {
      return {
        label: 'Drift',
        color: 'var(--vscode-editorError-foreground, #f14c4c)',
        title: `${findings.length} finding(s), including a destructive conflict — click to review`,
      };
    }
    return {
      label: 'Drift',
      color: 'var(--vscode-editorWarning-foreground, #cca700)',
      title: `${findings.length} reconcilable finding(s) — click to review`,
    };
  }, [consistencyChecking, consistencyResult]);

  return {
    consistencyResult,
    consistencyChecking,
    findingsRevealRequest,
    handleCheckConsistency,
    handleConsistencyResultMessage,
    consistencyBadge,
  };
}
