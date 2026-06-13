export type HdlLanguage = 'vhdl' | 'systemverilog';

// ---------------------------------------------------------------------------
// Scaffold Pack — manifest-driven code generation layout
// ---------------------------------------------------------------------------

/** One file entry in a scaffold pack manifest. */
export interface ScaffoldFileRule {
  /** Nunjucks-rendered path to the source template (relative to packDir or built-in templates). */
  source: string;
  /** Nunjucks-rendered output path relative to the output directory. */
  target: string;
  /** Nunjucks boolean expression evaluated against the template context. Absent = always included. */
  condition?: string;
  /**
   * When false, the file is user-owned: written only on first generation, never overwritten.
   * Defaults to true (managed by IPCraft, always regenerated).
   */
  managed?: boolean;
}

/**
 * A resolved scaffold pack — the in-memory representation of a scaffold.yml manifest.
 * Built-in packs live in dist/packs/; user packs live in .vscode/ipcraft/packs/<name>/.
 */
export interface ScaffoldPack {
  name: string;
  description?: string;
  /**
   * Grouping label shown in the export QuickPick.
   * Read from scaffold.yml `category` field; workspace packs are assigned `"workspace"` at load time.
   */
  category?: string;
  /** Absolute path to the directory containing scaffold.yml and pack-local templates. */
  packDir: string;
  files: ScaffoldFileRule[];
  /**
   * When true, testbench generation gets the full register/bus context (bahonavi-style).
   * When false, testbench sees a minimal stub without register signals.
   */
  fullGeneration?: boolean;
}

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
  /** Testbench framework: 'cocotb' (default) or 'vunit'. */
  framework?: string;
  /** Simulation engine: 'ghdl' (default), 'icarus', 'verilator', 'questa'. */
  engine?: string;
  /**
   * Enable the bahonavi methodology: full multi-file generation (top, core, bus wrapper,
   * package, register file). When false (default), only a single minimal top-level stub
   * is generated with an empty architecture/module body.
   * Ignored when scaffold_pack is set explicitly.
   */
  bahonaviMethodology?: boolean;
  /**
   * Name of the scaffold pack to use for RTL file generation.
   * Overrides bahonaviMethodology when present.
   * Resolves workspace pack first (.vscode/ipcraft/packs/<name>/), then built-in packs.
   */
  scaffoldPack?: string;
  /** When true, generate content in memory only — do not write files to disk. */
  dryRun?: boolean;
}

export interface GenerateResult {
  success: boolean;
  /** relativePath → fullPath for files actually written to disk (absent in dry-run mode). */
  files?: Record<string, string>;
  /** relativePath → file content for all generated files (always present on success). */
  generatedContents?: Record<string, string>;
  /** Relative paths of managed:false files that already exist on disk (skip on write). */
  protectedPaths?: string[];
  /** The scaffold pack id that was actually used (e.g. "builtin-bahonavi"). */
  resolvedPackName?: string;
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
  indexStart?: number;
  namingPattern?: string;
  physicalPrefixPattern?: string;
}

export interface BusInterfaceDef {
  name?: string;
  type?: string;
  /** Raw VLNV components for unknown bus types parsed from component.xml. Avoids re-splitting the dot-joined type string which is ambiguous (vendor TLDs and versions both contain dots). */
  busTypeVlnv?: VlnvDef;
  mode?: string;
  physicalPrefix?: string;
  useOptionalPorts?: string[];
  portWidthOverrides?: Record<string, number | string>;
  portNameOverrides?: Record<string, string>;
  /** Logical port names (uppercase) absent from the user's HDL source — skipped in generation. */
  absentPorts?: string[];
  associatedClock?: string;
  associatedReset?: string;
  array?: BusInterfaceArrayDef;
  /** User-defined signals for conduit (custom) interfaces. */
  conduitPorts?: Array<Record<string, unknown>>;
  ports?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ParameterDef {
  name?: string;
  value?: number | string;
  dataType?: string;
  description?: string;
  min?: number | null;
  max?: number | null;
  allowedValues?: Array<number | string> | null;
  uiPage?: string | null;
  uiGroup?: string | null;
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
  associatedReset?: string;
}

export interface ResetDef {
  name?: string;
  polarity?: string;
  associatedClock?: string;
}

export interface SubcoreRef {
  vlnv: string;
  path?: string;
}

export interface IpCoreData {
  vlnv?: VlnvDef;
  description?: string;
  scaffoldPack?: string;
  parameters?: ParameterDef[];
  ports?: PortDef[];
  busInterfaces?: BusInterfaceDef[];
  clocks?: ClockDef[];
  resets?: ResetDef[];
  memoryMaps?: unknown; // Tolerant memory maps structure
  subcores?: SubcoreRef[];
  targets?: string[];
  simulation?: SimulationConfig;
  [key: string]: unknown;
}

export interface SimulationConfig {
  /** Framework override: 'cocotb' | 'vunit'. */
  framework?: string;
  /** Engine override: 'ghdl' | 'icarus' | 'verilator' | 'questa'. */
  engine?: string;
  /** Extra compile-time arguments forwarded to the engine. */
  compileArgs?: string[];
  /** Extra simulation-time arguments forwarded to the engine. */
  simArgs?: string[];
  /** Environment variables forwarded to the simulation process. */
  env?: Record<string, string>;
  /** Engine-specific free-form options. */
  vendorOptions?: Record<string, unknown>;
}

export interface BusTypeInfo {
  libraryKey: string;
  templateType: string;
}
