/**
 * Hand-written types for resource usage in the system viewer: the numbers of a
 * Vivado or Quartus utilization report mapped onto the blocks of a
 * `SystemGraph` (see docs/concepts/brainstorm/system-resource-usage.md).
 * JSON-serializable only (no Map, no bigint) because the report crosses the
 * extension/webview process boundary.
 */

export type ResourceVendor = 'vivado' | 'quartus';

/** `ooc`: per-IP out-of-context synthesis; `fit`: the Quartus fitter. */
export type ResourceStage = 'ooc' | 'synth' | 'placed' | 'routed' | 'fit';

export interface ResourceMetric {
  /** Stable id, also the key of device capacity (`lut`, `ff`, `bram`, `dsp`, `alm`, ...). */
  key: string;
  /** As shown to the user; non-primary metrics are labelled as the report column is. */
  label: string;
  /** One of the four metrics shown on every block header. */
  primary: boolean;
  /** Units available on the device, when known. */
  capacity?: number;
}

/** Arrays are aligned with {@link ResourceReport.metrics}. */
export interface ResourceUsage {
  total: number[];
  /** The block's own logic, excluding its children; `null`: the report gives no self figure for that metric. */
  self?: Array<number | null>;
  /** A hierarchy total in the OOC stage: the sum of the IPs inside, not a measured figure. */
  summed?: true;
}

/** A report row under a level that is no block of the diagram (for example a generated interconnect). */
export interface ResourceOther {
  /** Level path of the diagram that contains the row. */
  level: string;
  name: string;
  module?: string;
  usage: ResourceUsage;
}

export interface ResourceReport {
  vendor: ResourceVendor;
  stage: ResourceStage;
  source: {
    fileName: string;
    /** As written in the report header. */
    date?: string;
    toolVersion?: string;
    device?: string;
    design?: string;
  };
  metrics: ResourceMetric[];
  /** Usage of the design root. */
  design: ResourceUsage;
  /** Keyed by `SystemInstance.path`. */
  instances: Record<string, ResourceUsage>;
  others: ResourceOther[];
  /** Report top total minus the design root: logic above the design (glue logic, a wrapper). Omitted when all zero. */
  outside?: number[];
  /** Instance paths of the graph with no row in the report. */
  notInReport: string[];
  /** Report paths (`sys_wrapper/sys_i`, `|top|sys:u0`) of every row that could be the design. */
  rootCandidates: string[];
  /** The report path used as the design root. */
  root?: string;
  diagnostics: Array<{ severity: 'warning' | 'info'; message: string }>;
}
