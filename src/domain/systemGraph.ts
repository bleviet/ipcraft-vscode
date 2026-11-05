/**
 * Hand-written types for the offline system viewer (issue #239): a vendor-neutral
 * graph of instances, pins, nets and address segments read statically from a
 * Vivado block design script or a Platform Designer `.qsys` file.
 * JSON-serializable only (no Map, no bigint) because the
 * graph crosses the extension/webview process boundary.
 */

export type PinDirection = 'in' | 'out' | 'inout' | 'master' | 'slave' | 'unknown';
export type PinDirectionSource = 'declared' | 'connection' | 'name' | 'definition' | 'unknown';
/** `create_bd_(port|pin) -type` */
export type SignalType = 'clk' | 'rst' | 'intr' | 'data' | 'ce' | 'undef';
export type NetCategory =
  | 'aximm'
  | 'axis'
  | 'avalonmm'
  | 'avalonst'
  | 'interface'
  | 'clock'
  | 'reset'
  | 'interrupt'
  | 'signal';
export type CapabilityState = 'complete' | 'partial' | 'unavailable';

export interface SystemPin {
  name: string;
  isInterface: boolean;
  direction: PinDirection;
  directionSource: PinDirectionSource;
  /** Interface ports/pins: `-vlnv`. */
  vlnv?: string;
  /** qsys: interface/connection type as written (`avalon`, `clock`, `conduit`, ...). */
  interfaceType?: string;
  /** Scalar ports/pins: `-type`. */
  signalType?: SignalType;
  /** `-from` / `-to`. */
  width?: { from: number; to: number };
  /** `set_property` on ports/pins, key as written (e.g. `CONFIG.SENSITIVITY`). */
  parameters: Record<string, string>;
  /** 1-based declaration line (boundary pins only). */
  line?: number;
  /** Set when the pin exists in the instance's definition (added or matched). */
  definedBy?: 'ip.yml' | 'hdl';
}

export interface SystemInstance {
  /** Absolute: `/axi_dma_0`, `/dsp_pipeline/coeff_bank/config_fifo`. */
  path: string;
  name: string;
  /** Level path that contains it (`/` for root). */
  parent: string;
  kind: 'ip' | 'hier' | 'module';
  /** kind `ip`. */
  vlnv?: string;
  /** kind `module` (`-reference`). */
  moduleRef?: string;
  /** qsys (kind `ip`, no `vlnv`): module `kind`, e.g. `altera_nios2_gen2`. */
  component?: string;
  /** qsys: module `version`. */
  version?: string;
  /** Key as written, e.g. `CONFIG.c_include_sg`. */
  parameters: Record<string, string>;
  /** ip/module: pins seen in connections; hier: the level's boundary pins. */
  pins: SystemPin[];
  /** Line of the `create_bd_cell` (or the `create_hier_cell_*` call for hier). */
  line: number;
  /** hier: line of `proc create_hier_cell_<x>`. */
  procLine?: number;
  /** Workspace file that defines the instance's pins (enrichment). `file` is the absolute path, `uri` the `Uri.toString()` used to open it. */
  definition?: { kind: 'ip.yml' | 'hdl'; file: string; uri: string; displayName: string };
}

export interface SystemLevel {
  /** `/` or the hier instance path. */
  path: string;
  /** Design name for `/`, instance name otherwise. */
  name: string;
  /** Root: external ports; hier: hier pins. */
  boundaryPins: SystemPin[];
  /** Child instance paths, in creation order. */
  instances: string[];
}

/** `instance: null` is a boundary pin of the net's level. */
export interface PinRef {
  instance: string | null;
  pin: string;
}

export interface SystemNet {
  /** `${level}::${name}` (unique). */
  id: string;
  name: string;
  level: string;
  isInterface: boolean;
  category: NetCategory;
  categorySource: 'declared' | 'name' | 'default';
  /** In script order. */
  endpoints: PinRef[];
  /** First connect command for this net. */
  line: number;
}

export interface AddressSegment {
  /** As written, e.g. `processing_system7_0/Data`; qsys: the connection start (`cpu.data_master`). */
  addressSpace: string;
  /** As written, e.g. `axi_dma_0/S_AXI_LITE/Reg`; qsys: the connection end (`uart.avalon_slave`). */
  segment: string;
  /** Address space minus its last component, e.g. `/processing_system7_0`; qsys: the start instance. */
  masterInstance: string;
  /** Segment minus its last two components, e.g. `/axi_dma_0`; qsys: the end instance. */
  slaveInstance: string;
  /** As written, e.g. `0x40400000`; qsys: `baseAddress`. Undefined when the tool assigns it. */
  offset?: string;
  /** As written, e.g. `0x00010000`; qsys: always undefined (the size is in the slave definition). */
  range?: string;
  line: number;
}

export interface SystemDiagnostic {
  severity: 'warning' | 'info';
  message: string;
  lines?: number[];
}

export interface SystemGraph {
  name: string;
  source: { fileName: string; format: 'vivado-bd-tcl' | 'qsys' | 'qsys-tcl'; toolVersion?: string };
  /** Keyed by path; always contains `/`. */
  levels: Record<string, SystemLevel>;
  instances: Record<string, SystemInstance>;
  nets: SystemNet[];
  addressSegments: AddressSegment[];
  capabilities: {
    hierarchy: CapabilityState;
    connections: CapabilityState;
    addressMap: CapabilityState;
    userParameters: CapabilityState;
    propagatedParameters: CapabilityState;
    unconnectedPins: CapabilityState;
  };
  diagnostics: SystemDiagnostic[];
}
