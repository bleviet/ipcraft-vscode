export type VendorOption = 'none' | 'intel' | 'xilinx' | 'both';

export interface GenerateOptions {
  vendor?: VendorOption;
  includeTestbench?: boolean;
  includeRegs?: boolean;
  includeVhdl?: boolean;
  updateYaml?: boolean;
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
  width?: number;
  direction?: string;
  presence?: string;
};

export type BusDefinition = {
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
  port_width_overrides?: Record<string, number>;
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
}

export interface PortDef {
  name?: string;
  direction?: string;
  width?: number | string;
  presence?: string;
}

export interface ClockDef {
  name?: string;
}

export interface ResetDef {
  name?: string;
  polarity?: string;
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
  [key: string]: unknown;
}

export interface BusTypeInfo {
  libraryKey: string;
  templateType: string;
}
