export type HdlLanguage = 'vhdl' | 'systemverilog';

export interface GenerateOptions {
  /**
   * Synthesis vendor targets to generate packaging files for.
   * Each string must match a registered toolchain id ('vivado', 'quartus', …).
   * An empty array generates HDL and testbench only.
   */
  targets?: string[];
  includeTestbench?: boolean;
  includeRegs?: boolean;
  includeVhdl?: boolean;
  includeVivadoProject?: boolean;
  targetPart?: string;
  includeQuartusProject?: boolean;
  quartusDevice?: string;
  updateYaml?: boolean;
  hdlLanguage?: HdlLanguage;
}

export interface GenerateResult {
  success: boolean;
  files?: Record<string, string>;
  count?: number;
  busType?: string;
  error?: string;
}

export type BusPortDefinition = {
  name: string;
  /** Numeric width, or a parameter name string (e.g. "XCVR_DW") resolved at generation time */
  width?: number | string;
  direction?: string;
  presence?: string;
};

export type BusDefinition = {
  busType?: {
    vendor?: string;
    library?: string;
    name?: string;
    version?: string;
    description?: string;
  };
  ports?: BusPortDefinition[];
};

export type BusDefinitions = Record<string, BusDefinition>;

export interface VlnvDef {
  vendor?: string;
  library?: string;
  name?: string;
  version?: string;
}

export interface BusInterfaceArrayDef {
  count?: number;
  index_start?: number;
  naming_pattern?: string;
  physical_prefix_pattern?: string;
}

export interface BusInterfaceDef {
  name?: string;
  type?: string;
  mode?: string;
  physical_prefix?: string;
  use_optional_ports?: string[];
  port_width_overrides?: Record<string, number | string>;
  associated_clock?: string;
  associated_reset?: string;
  array?: BusInterfaceArrayDef;
  ports?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ParameterDef {
  name?: string;
  value?: number | string;
  data_type?: string;
  description?: string;
}

export interface PortDef {
  name?: string;
  direction?: string;
  width?: number | string;
  presence?: string;
}

export interface ClockDef {
  name?: string;
  frequency?: string | null;
  associated_reset?: string;
}

export interface ResetDef {
  name?: string;
  polarity?: string;
  associated_clock?: string;
}

export interface SubcoreRef {
  vlnv: string;
  path?: string;
}

export interface IpCoreData {
  vlnv?: VlnvDef;
  description?: string;
  parameters?: ParameterDef[];
  ports?: PortDef[];
  bus_interfaces?: BusInterfaceDef[];
  clocks?: ClockDef[];
  resets?: ResetDef[];
  memory_maps?: Record<string, unknown> | Record<string, unknown>[];
  subcores?: SubcoreRef[];
  [key: string]: unknown;
}

export interface BusTypeInfo {
  libraryKey: string;
  templateType: string;
}
