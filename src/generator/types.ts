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
   * When true, testbench generation gets the full register/bus context (IPCraft-style).
   * When false, testbench sees a minimal stub without register signals.
   */
  fullGeneration?: boolean;
  /**
   * SemVer range declaring which template context contract version this pack targets.
   * E.g. "^1.0" means compatible with any 1.x contract >= 1.0.
   * IPCraft rejects a pack whose apiVersion is not satisfied by the running CONTRACT_VERSION.
   * Absent means no version constraint (unversioned packs skip the check).
   */
  apiVersion?: string;
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
   * Name of the scaffold pack to use for RTL file generation.
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
  /** The scaffold pack id that was actually used (e.g. "builtin-ipcraft"). */
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
  /** Set to 'vivado' for interfaces discovered from a local Vivado install (e.g. fifo_write) —
   *  Vivado already ships busDefinition/abstractionDefinition XML for these, so IPCraft must
   *  not bundle a duplicate copy when packaging. Absent for user-authored custom interfaces. */
  source?: string;
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
  physicalPrefixPattern?: string | null;
}

export interface BusInterfaceDef {
  name?: string;
  type?: string;
  /** Raw VLNV components for unknown bus types parsed from component.xml. Avoids re-splitting the dot-joined type string which is ambiguous (vendor TLDs and versions both contain dots). */
  busTypeVlnv?: VlnvDef;
  /** Original logical→physical port maps for unknown bus types, annotated with direction and width from spirit:model/spirit:ports. Preserved so the generator can emit them verbatim without needing a bus definition. */
  rawPortMaps?: Array<{
    logical: string;
    physical: string;
    direction: 'in' | 'out';
    width: number;
  }>;
  mode?: string;
  physicalPrefix?: string | null;
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
