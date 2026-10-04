import { useCallback, useMemo, useState } from 'react';
import { checkBusConformance } from '../../../shared/busConformance';
import type { ConformanceReport, IpcraftIssue } from '../../../shared/issues';
import type { IpCore } from '../../types/ipCore';
import type { ValidationError } from './useIpCoreState';
import type { NormalizedBusLibrary } from '../../../shared/busContracts';
import {
  deduplicateAndOrderIssues,
  elementIdsForIssue,
  issuesToCanvasAnnotations,
  type IssueFocusRequest,
} from '../types/issues';

function referenceIssues(
  ipCore: IpCore | null,
  errors: readonly ValidationError[]
): IpcraftIssue[] {
  const buses = ipCore?.busInterfaces ?? [];
  return errors.map((error) => {
    const index = buses.findIndex((bus) => bus.name === error.entityName);
    return {
      code: `REFERENCE_${error.field.replace(/([A-Z])/g, '_$1').toUpperCase()}`,
      severity: 'error',
      source: 'references',
      path: index >= 0 ? ['busInterfaces', index, error.field] : ['busInterfaces'],
      interfaceName: error.entityName,
      message: error.message,
    };
  });
}

export function useIssuesSession(options: {
  ipCore: IpCore | null;
  revision: string;
  busLibrary?: NormalizedBusLibrary;
  validationErrors: readonly ValidationError[];
  consistencyIssues?: readonly IpcraftIssue[];
  onSelectElement: (id: string) => void;
  onSelectSubPort: (id: string) => void;
}) {
  const {
    ipCore,
    revision,
    busLibrary,
    validationErrors,
    consistencyIssues = [],
    onSelectElement,
    onSelectSubPort,
  } = options;
  const [hostReportState, setHostReportState] = useState<{
    report: ConformanceReport;
    revision: string;
  } | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const [focusRequest, setFocusRequest] = useState<IssueFocusRequest | null>(null);

  const hostReport = hostReportState?.revision === revision ? hostReportState.report : null;
  const setHostReport = useCallback(
    (report: ConformanceReport | null, reportRevision = revision) => {
      setHostReportState(report ? { report, revision: reportRevision } : null);
    },
    [revision]
  );

  const protocolReport = useMemo(() => {
    if (!ipCore || !busLibrary) {
      return null;
    }
    return checkBusConformance(ipCore, busLibrary);
  }, [ipCore, busLibrary]);

  const issues = useMemo(
    () =>
      deduplicateAndOrderIssues([
        ...(protocolReport?.issues ?? []),
        ...referenceIssues(ipCore, validationErrors),
        ...consistencyIssues,
        ...(hostReport?.issues ?? []),
      ]),
    [protocolReport, ipCore, validationErrors, consistencyIssues, hostReport]
  );

  const focusIssue = useCallback(
    (issue: IpcraftIssue) => {
      const ids = elementIdsForIssue(issue);
      if (ids[0]) {
        onSelectElement(ids[0]);
      }
      if (ids[1]) {
        onSelectSubPort(ids[1]);
      }
      setFocusRequest((previous) => ({ path: issue.path, nonce: (previous?.nonce ?? 0) + 1 }));
    },
    [onSelectElement, onSelectSubPort]
  );

  const openIssues = useCallback(
    (preferredIssue?: IpcraftIssue) => {
      setShowIssues(true);
      const target =
        preferredIssue ??
        issues.find((issue) => issue.severity === 'error') ??
        issues.find((issue) => issue.severity === 'warning');
      if (target) {
        focusIssue(target);
      }
    },
    [issues, focusIssue]
  );

  const handleGenerateResult = useCallback(
    (message: { success: boolean; issues?: readonly IpcraftIssue[]; sourceRevision?: string }) => {
      if (message.sourceRevision && message.sourceRevision !== revision) {
        return;
      }
      if (message.success) {
        setHostReportState(null);
        return;
      }
      if (!message.issues?.length) {
        return;
      }
      const report: ConformanceReport = {
        issues: message.issues,
        hasKnownErrors: message.issues.some((issue) => issue.severity === 'error'),
        hasUnresolved: message.issues.some((issue) => issue.code === 'BUS_TYPE_UNRESOLVED'),
      };
      setHostReportState({ report, revision });
      setShowIssues(true);
      const target =
        message.issues.find((issue) => issue.severity === 'error') ?? message.issues[0];
      if (target) {
        focusIssue(target);
      }
    },
    [focusIssue, revision]
  );

  return {
    issues,
    annotations: issuesToCanvasAnnotations(issues),
    errorCount: issues.filter((issue) => issue.severity === 'error').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length,
    importSaveBlocked: hostReport?.hasKnownErrors ?? protocolReport?.hasKnownErrors ?? false,
    hasUnresolved: hostReport?.hasUnresolved ?? protocolReport?.hasUnresolved ?? false,
    showIssues,
    setShowIssues,
    openIssues,
    focusIssue,
    focusRequest,
    setHostReport,
    handleGenerateResult,
  };
}
