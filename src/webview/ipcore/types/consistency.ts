import type { CanvasAnnotations } from '../hooks/useCanvasValidation';

export type ConsistencyKind =
  | 'top-level-ambiguity'
  | 'missing-port'
  | 'extra-port'
  | 'direction-mismatch'
  | 'width-mismatch'
  | 'missing-parameter'
  | 'extra-parameter'
  | 'parameter-default-mismatch'
  | 'missing-bus-port'
  | 'bus-port-width-mismatch'
  | 'bus-port-direction-mismatch'
  | 'missing-register'
  | 'extra-register'
  | 'register-address-mismatch'
  | 'missing-field'
  | 'extra-field'
  | 'field-range-mismatch';

export type ConsistencySeverity = 'amber' | 'red';
export type ConsistencySource = 'hdl' | 'hwTcl' | 'componentXml';

export interface ConsistencyInferredPort {
  name: string;
  direction?: string;
  width?: number | string;
}

export interface ConsistencyInferredParameter {
  name: string;
  value?: string;
}

export interface ConsistencyFinding {
  kind: ConsistencyKind;
  message: string;
  ipYmlPath: (string | number)[];
  hdlFile: string;
  hdlEntity: string | null;
  severity: ConsistencySeverity;
  source: ConsistencySource;
  inferred?: ConsistencyInferredPort | ConsistencyInferredParameter;
}

export interface ConsistencySummary {
  added: number;
  removed: number;
  changed: number;
  /**
   * Informational only — the checker could not uniquely identify the top-level implementation
   * to diff against (issue #161). Not evidence of actual .ip.yml/HDL drift.
   */
  ambiguous: number;
}

/** Kinds that report an unresolved checker precondition rather than actual interface drift. */
const AMBIGUOUS_KINDS = new Set<ConsistencyKind>(['top-level-ambiguity']);

export function isAmbiguousFinding(finding: ConsistencyFinding): boolean {
  return AMBIGUOUS_KINDS.has(finding.kind);
}

const SOURCE_LABEL: Record<ConsistencySource, string> = {
  hdl: 'HDL',
  hwTcl: 'Platform Designer',
  componentXml: 'Vivado',
};

export function sourceLabel(source: ConsistencySource): string {
  return SOURCE_LABEL[source];
}

export const CONSISTENCY_KIND_LABEL: Record<ConsistencyKind, string> = {
  'top-level-ambiguity': 'Top-level ambiguity',
  'missing-port': 'Missing port',
  'extra-port': 'New port',
  'direction-mismatch': 'Direction mismatch',
  'width-mismatch': 'Width mismatch',
  'missing-parameter': 'Missing parameter',
  'extra-parameter': 'New parameter',
  'parameter-default-mismatch': 'Default mismatch',
  'missing-bus-port': 'Missing bus port',
  'bus-port-width-mismatch': 'Bus port width mismatch',
  'bus-port-direction-mismatch': 'Bus port direction mismatch',
  'missing-register': 'Missing register',
  'extra-register': 'New register',
  'register-address-mismatch': 'Register address mismatch',
  'missing-field': 'Missing field',
  'extra-field': 'New field',
  'field-range-mismatch': 'Field range mismatch',
};

/** Stable identity for session-local "Ignore" — findings carry no id of their own. */
export function findingKey(finding: ConsistencyFinding): string {
  return [finding.source, finding.kind, finding.ipYmlPath.join('.'), finding.hdlFile].join('|');
}

const COLLECTION_TO_ELEMENT_KIND: Record<string, string> = {
  ports: 'port',
  clocks: 'clock',
  resets: 'reset',
  parameters: 'parameter',
};

/**
 * Maps a finding to the canvas element it should annotate (the same `kind:index` id scheme
 * `useCanvasValidation` uses). Returns null for extra-port/extra-parameter: those describe an
 * implementation-only signal with no corresponding row in the .ip.yml yet, so there is no
 * existing canvas element to attach a dot to — they surface only in the results overlay.
 */
export function elementIdForFinding(finding: ConsistencyFinding): string | null {
  const [collection, index] = finding.ipYmlPath;
  if (typeof collection !== 'string' || typeof index !== 'number') {
    return null;
  }
  const kind = COLLECTION_TO_ELEMENT_KIND[collection];
  return kind ? `${kind}:${index}` : null;
}

/**
 * Projects consistency findings onto the same annotation shape `useCanvasValidation` produces
 * (severity 'warning' | 'error') so the canvas can render both through the existing
 * `.ip-canvas-annotation-dot` mechanism without a parallel rendering path: amber (reconcilable
 * drift) maps to 'warning', red (conflicting/destructive drift) maps to 'error'.
 */
export function consistencyFindingsToAnnotations(
  findings: ConsistencyFinding[],
  ignoredKeys: ReadonlySet<string>
): CanvasAnnotations {
  const annotations: CanvasAnnotations = {};
  for (const finding of findings) {
    if (ignoredKeys.has(findingKey(finding))) {
      continue;
    }
    const id = elementIdForFinding(finding);
    if (!id) {
      continue;
    }
    (annotations[id] ??= []).push({
      severity: finding.severity === 'red' ? 'error' : 'warning',
      message: `[${sourceLabel(finding.source)}] ${finding.message}`,
    });
  }
  return annotations;
}

/** Plain-text rendering of the results overlay's contents, for the "Copy" toolbar action. */
export function formatFindingsForClipboard(
  findings: ConsistencyFinding[],
  summary: ConsistencySummary
): string {
  const lines: string[] = [
    `IPCraft Consistency Check — ${findings.length} finding(s) ` +
      `(${summary.added} added, ${summary.removed} removed, ${summary.changed} changed, ` +
      `${summary.ambiguous} ambiguous)`,
    '',
  ];
  for (const finding of findings) {
    lines.push(
      `[${finding.severity}] ${CONSISTENCY_KIND_LABEL[finding.kind]} · ${sourceLabel(finding.source)}`,
      finding.message,
      ''
    );
  }
  return lines.join('\n').trimEnd();
}
