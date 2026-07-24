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
  /**
   * When true, IPCraft sets the POSIX executable bit (owner/group/other +x) on this file
   * after writing it — for pack-owned helper scripts meant to be run directly, e.g.
   * `./qsys_<name>_tb_gen.sh` (issue #153). Existing permission bits are preserved; only the
   * execute bits are added. No-op on filesystems that don't support POSIX permission bits.
   * Defaults to false.
   */
  executable?: boolean;
}

/**
 * Input compatibility a scaffold pack declares in its manifest (issues #152, #154). Checked once,
 * before any file is rendered or written, so an incompatible pack/IP-core pairing fails fast
 * with an actionable reason instead of silently producing a partial or invalid file tree.
 * Absent fields impose no constraint; a pack that omits `requirements` entirely accepts any
 * input, matching pre-existing manifests.
 */
export interface ScaffoldPackRequirements {
  /** HDL languages this pack can render. Checked against the `--hdl-language` generate option. */
  hdlLanguages?: HdlLanguage[];
  /**
   * Bus type ids this pack supports (e.g. "avmm", "axil" — the same short ids used by
   * `BUS_REGISTRY`/`getBusTypeForTemplate`). Checked against the IP core's primary slave
   * interface type.
   */
  busTypes?: string[];
  /** Whether the IP core must ("required") or must not ("forbidden") have a memory-mapped slave. */
  memoryMappedSlave?: 'required' | 'forbidden';
  /**
   * Logical port names (case-insensitive) that must be active on the IP core's primary bus
   * interface — e.g. Avalon-MM's optional ports all default to disabled, so an interface with
   * no `useOptionalPorts` renders with zero signals unless a pack requires some here.
   */
  logicalPorts?: string[];
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
   * A full-generation pack that declares both its own testbench and runner is also inferred
   * to own the complete generated tree, suppressing IPCraft framework, docs, and vendor files.
   */
  fullGeneration?: boolean;
  /**
   * When false, IPCraft's framework testbench generation (tb/*, .vscode/settings.json) is
   * suppressed entirely, regardless of the `includeTestbench` generate option — the pack owns
   * the complete simulation environment itself (issue #151). Defaults to true so existing packs
   * keep their current output.
   */
  generateFrameworkTestbench?: boolean;
  /**
   * True when the manifest explicitly set `generateFrameworkTestbench` (either value) rather
   * than relying on its default-true. Set by ScaffoldPackLoader, not pack authors. Used to gate
   * the "pack looks like it ships its own testbench but didn't opt out" warning (issue #156) —
   * a pack that made an explicit choice never needs that warning, regardless of what it renders.
   */
  generateFrameworkTestbenchDeclared?: boolean;
  /**
   * SemVer range declaring which template context contract version this pack targets.
   * E.g. "^1.0" means compatible with any 1.x contract >= 1.0.
   * IPCraft rejects a pack whose apiVersion is not satisfied by the running CONTRACT_VERSION.
   * Absent means no version constraint (unversioned packs skip the check).
   */
  apiVersion?: string;
  /** Input compatibility declarations, validated before any file is rendered (issue #152). */
  requirements?: ScaffoldPackRequirements;
}

export interface GenerateOptions {
  /**
   * Synthesis vendor targets to generate packaging files for.
   * Each string must match a registered toolchain id ('vivado', 'quartus', …).
   * An empty array generates HDL and testbench only.
   */
  targets?: string[];
  includeTestbench?: boolean;
  /** Generate a Markdown IP datasheet (docs/&lt;name&gt;_datasheet.md). Opt-in; defaults to off. */
  includeDocs?: boolean;
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
  /**
   * Relative paths (within generatedContents) whose scaffold rule declared `executable: true`
   * (issue #153). Callers that write files outside IpCoreScaffolder's own write path (e.g. the
   * VS Code staging UI) must apply the executable bit to these paths themselves after writing.
   */
  executablePaths?: string[];
  /**
   * Relative paths (within generatedContents) produced by IPCraft's default framework testbench
   * generation (tb/*, .vscode/settings.json) rather than by the active scaffold pack's own file
   * rules (issue #156). Callers that stage generated output for review (the VS Code staging UI)
   * use this to visually distinguish framework-owned files from pack-owned ones. Empty when
   * `generateFrameworkTestbench` is false or testbench generation was skipped.
   */
  frameworkTestbenchPaths?: string[];
  /**
   * Human-readable warnings about the generation that don't fail the run, e.g. a pack that
   * renders its own simulation-looking output under conventional tb/sim/testbench/test paths
   * without explicitly declaring `generateFrameworkTestbench` (issue #156) — surfaced by the
   * staging UI and the `ipcraft generate`/`ipcraft verify` CLI so it's unmissable before the
   * generated output is actually written.
   */
  warnings?: string[];
  /**
   * Every path declared managed: false in the .ip.yml's fileSets, regardless of whether it
   * collides with a scaffold-pack target — a superset of protectedPaths (dry-run only).
   */
  userManagedPaths?: string[];
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
  /** Endianness role of the port:
   *  - 'data': carries the data payload (e.g. WDATA/RDATA/TDATA); byte-reversed on big-endian.
   *  - 'byteQualifier': per-byte-lane mask (e.g. WSTRB/TKEEP/byteenable); bit-reversed in
   *    lockstep with the data so the lane mask stays aligned with the reversed bytes. */
  role?: 'data' | 'byteQualifier';
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
  /** Name of the memory map this (slave) interface exposes — matches a map's `name`. */
  memoryMapRef?: string;
  /** Byte order for this interface's data port(s). Little-endian is the default. */
  endianness?: 'little' | 'big';
  array?: BusInterfaceArrayDef;
  /** User-defined signals for conduit (custom) interfaces. */
  conduitPorts?: Array<Record<string, unknown>>;
  ports?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ParameterDef {
  name?: string;
  displayName?: string | null;
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
  /** Byte order for this port. Little-endian is the default. */
  endianness?: 'little' | 'big';
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
  author?: string;
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
  /** Testbench top-level entity/module override (e.g. a board wrapper). Defaults to the IP core name. */
  topLevel?: string;
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
