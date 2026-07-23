import { useCallback, useMemo, useState } from 'react';
import { vscode } from '../../vscode';
import type { IpCore } from '../../types/ipCore';
import type { YamlUpdateHandler } from '../../types/editor';
import {
  consistencyFindingsToAnnotations,
  findingKey,
  type ConsistencyFinding,
  type ConsistencyInferredParameter,
  type ConsistencyInferredPort,
  type ConsistencySummary,
} from '../types/consistency';

export interface ConsistencyResultMessage {
  auto?: boolean;
  error?: string;
  findings?: ConsistencyFinding[];
  summary?: ConsistencySummary;
}

export interface ConsistencyBadge {
  label: string;
  color: string;
  title: string;
}

/**
 * Consistency-check session (issue #84): request/response state, session-local
 * ignores, the toolbar badge, and the adopt/select/regenerate actions the
 * results overlay exposes. Extracted from IpCoreApp (issue #129).
 */
export function useConsistencySession(opts: {
  ipCore: unknown;
  updateIpCore: YamlUpdateHandler;
  onSelectElement: (id: string) => void;
  showToast: (message: string) => void;
}) {
  const { ipCore, updateIpCore, onSelectElement, showToast } = opts;

  // Result of the last completed run, session-local ignores, and whether the
  // results overlay currently occupies the inspector's right slot.
  const [consistencyResult, setConsistencyResult] = useState<{
    findings: ConsistencyFinding[];
    summary: ConsistencySummary;
  } | null>(null);
  const [consistencyChecking, setConsistencyChecking] = useState(false);
  const [ignoredConsistencyKeys, setIgnoredConsistencyKeys] = useState<Set<string>>(new Set());
  const [showConsistencyOverlay, setShowConsistencyOverlay] = useState(false);

  const handleCheckConsistency = useCallback(() => {
    setConsistencyChecking(true);
    vscode?.postMessage({ type: 'checkConsistency' });
  }, []);

  const handleIgnoreConsistencyFinding = useCallback((key: string) => {
    setIgnoredConsistencyKeys((prev) => new Set(prev).add(key));
  }, []);

  // Adopting an implementation-only port/parameter is a normal structural edit (append to the
  // array, same path onUpdate already uses for every other insert) — it needs no new backend
  // message. The finding is suppressed locally via the same ignore mechanism until the user
  // re-checks and gets a result that no longer includes it.
  const handleAdoptConsistencyFinding = useCallback(
    (finding: ConsistencyFinding) => {
      const ip = ipCore as IpCore;
      if (finding.kind === 'extra-port' && finding.inferred) {
        const inferred = finding.inferred as ConsistencyInferredPort;
        updateIpCore(
          ['ports'],
          [
            ...((ip.ports as unknown[]) ?? []),
            { name: inferred.name, direction: inferred.direction ?? 'in', width: inferred.width },
          ]
        );
      } else if (finding.kind === 'extra-parameter' && finding.inferred) {
        const inferred = finding.inferred as ConsistencyInferredParameter;
        const numeric = inferred.value !== undefined ? Number(inferred.value) : NaN;
        const value =
          inferred.value !== undefined && inferred.value.trim() !== '' && !Number.isNaN(numeric)
            ? numeric
            : inferred.value;
        updateIpCore(
          ['parameters'],
          [...((ip.parameters as unknown[]) ?? []), { name: inferred.name, value }]
        );
      } else {
        return;
      }
      handleIgnoreConsistencyFinding(findingKey(finding));
    },
    [ipCore, updateIpCore, handleIgnoreConsistencyFinding]
  );

  const handleSelectConsistencyElement = useCallback(
    (elementId: string) => {
      setShowConsistencyOverlay(false);
      onSelectElement(elementId);
    },
    [onSelectElement]
  );

  // Reuses the exact "Scaffold Project" command (issue #93) rather than the bare `generate`
  // message: `generate` goes through handleGenerateRequest, which prompts for an output folder
  // and writes directly with no review step — unlike scaffoldProject's dry-run + staging list,
  // which is what a user reconciling drift from the Consistency Check overlay actually expects.
  const handleRegenerateFromConsistency = useCallback(() => {
    setShowConsistencyOverlay(false);
    vscode?.postMessage({ type: 'command', command: 'fpga-ip-core.scaffoldProject' });
  }, []);

  // Background checks (issue #84) run silently: update the badge, but never surface an
  // error toast or pop the results overlay open uninvited — only the manual button/badge
  // click (or a foreground check that finds something) does that.
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
        summary: message.summary ?? { added: 0, removed: 0, changed: 0 },
      });
      setIgnoredConsistencyKeys(new Set());
      if (!isAutoCheck) {
        if ((message.findings ?? []).length > 0) {
          setShowConsistencyOverlay(true);
        } else {
          showToast('IPCraft: consistent with every checked implementation source.');
        }
      }
    },
    [showToast]
  );

  const consistencyAnnotations = useMemo(
    () =>
      consistencyFindingsToAnnotations(consistencyResult?.findings ?? [], ignoredConsistencyKeys),
    [consistencyResult, ignoredConsistencyKeys]
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
    const visibleFindings = consistencyResult.findings.filter(
      (f) => !ignoredConsistencyKeys.has(findingKey(f))
    );
    if (visibleFindings.length === 0) {
      return {
        label: 'Consistent',
        color: 'var(--vscode-charts-green, #3aaa5c)',
        title: 'Consistent with every checked implementation source',
      };
    }
    // "Conflict" vs "Drift" read as two different problems when they're really the same one
    // (the .ip.yml disagrees with what's on disk) — issue #92. One label, "Drift", for any
    // non-empty result; the dot color still carries the reconcilable/destructive distinction.
    if (visibleFindings.some((f) => f.severity === 'red')) {
      return {
        label: 'Drift',
        color: 'var(--vscode-editorError-foreground, #f14c4c)',
        title: `${visibleFindings.length} finding(s), including a destructive conflict — click to review`,
      };
    }
    return {
      label: 'Drift',
      color: 'var(--vscode-editorWarning-foreground, #cca700)',
      title: `${visibleFindings.length} reconcilable finding(s) — click to review`,
    };
  }, [consistencyChecking, consistencyResult, ignoredConsistencyKeys]);

  return {
    consistencyResult,
    consistencyChecking,
    ignoredConsistencyKeys,
    showConsistencyOverlay,
    setShowConsistencyOverlay,
    handleCheckConsistency,
    handleIgnoreConsistencyFinding,
    handleAdoptConsistencyFinding,
    handleSelectConsistencyElement,
    handleRegenerateFromConsistency,
    handleConsistencyResultMessage,
    consistencyAnnotations,
    consistencyBadge,
  };
}
