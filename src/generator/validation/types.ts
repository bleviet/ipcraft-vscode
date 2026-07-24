/**
 * Shared finding types for the Consistency Check engine, split out of hdlCrossCheck.ts so
 * registerCrossCheck.ts (the memory-map/register diff arm, issue #96) can depend on them
 * without creating a cycle back through hdlCrossCheck.ts, which itself calls into
 * registerCrossCheck.ts to run the register diff alongside the port/parameter diff.
 */

export type HdlCrossCheckKind =
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

/** amber = additive/reconcilable (e.g. a new HDL port not yet in the .ip.yml); red = destructive/conflict. */
export type ConsistencySeverity = 'amber' | 'red';

export type ConsistencySource = 'hdl' | 'hwTcl' | 'componentXml';

export const SEVERITY_BY_KIND: Record<HdlCrossCheckKind, ConsistencySeverity> = {
  'top-level-ambiguity': 'amber',
  'missing-port': 'red',
  'extra-port': 'amber',
  'direction-mismatch': 'red',
  'width-mismatch': 'amber',
  'missing-parameter': 'red',
  'extra-parameter': 'amber',
  'parameter-default-mismatch': 'amber',
  'missing-bus-port': 'red',
  'bus-port-width-mismatch': 'amber',
  'bus-port-direction-mismatch': 'red',
  'missing-register': 'red',
  'extra-register': 'amber',
  'register-address-mismatch': 'amber',
  'missing-field': 'red',
  'extra-field': 'amber',
  'field-range-mismatch': 'amber',
};

export interface InferredPort {
  name: string;
  direction?: string;
  width?: number | string;
}

export interface InferredParameter {
  name: string;
  value?: string;
}

export interface HdlCrossCheckFinding {
  kind: HdlCrossCheckKind;
  message: string;
  /** Path into the .ip.yml, e.g. ['ports', 2], ['clocks', 0] or ['parameters', 1]. For
   *  extra-port/extra-parameter (no existing entry yet) this is the collection itself,
   *  e.g. ['ports'], since there is no index to point at. */
  ipYmlPath: (string | number)[];
  /** Path (relative to the ip core dir) of the implementation source this finding came from. */
  hdlFile: string;
  /** Top-level entity/module/component name parsed from hdlFile, or null if it couldn't be found. */
  hdlEntity: string | null;
  severity: ConsistencySeverity;
  source: ConsistencySource;
  /** For extra-port/extra-parameter: the implementation-declared shape, ready to insert into the
   *  .ip.yml verbatim if the user chooses to adopt it. */
  inferred?: InferredPort | InferredParameter;
}
