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
