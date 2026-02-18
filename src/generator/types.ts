export type VendorOption = "none" | "intel" | "xilinx" | "both";

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
