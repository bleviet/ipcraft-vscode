import type * as vscode from 'vscode';
import type { BuildReports } from '../ReportParser';
import type { BusDefinitions, IpCoreData } from '../../generator/types';
import type { NormalizedMemoryMap } from '../../domain/internal.types';
import type { TemplateLoader } from '../../generator/TemplateLoader';
import type { LaunchableTool } from './LaunchableTool';

/** Context passed to each toolchain's scaffold() method. */
export interface ScaffoldContext {
  name: string;
  templateContext: Record<string, unknown>;
  templates: TemplateLoader;
  ipCoreData: IpCoreData;
  busDefinitions: BusDefinitions;
  isSv: boolean;
  /** Resolved memory maps from the IP's `.mm.yml`, for vendor packaging that emits register definitions. */
  memoryMaps: NormalizedMemoryMap[];
}

/** Per-toolchain scaffold options (superset; each toolchain uses what it needs). */
export interface ScaffoldOptions {
  /** Whether to generate the project TCL + constraints in addition to packaging files. */
  includeProject?: boolean;
  /** RTL file paths relative to the vendor subdir (e.g. '../rtl/foo.vhd'). */
  rtlFiles?: string[];
  /** Vivado: target part number */
  targetPart?: string;
  /** Quartus: target device */
  quartusDevice?: string;
}

/** A runnable build target detected by the toolchain. */
export interface BuildMode {
  label: string;
  description: string;
  /** Build directory where reports will be written. */
  buildDir: string;
  /** Run the build, return parsed reports on success or undefined on failure. */
  run: () => Promise<BuildReports | undefined>;
}

/**
 * A synthesis vendor toolchain (Vivado, Quartus, …).
 * Extends the common LaunchableTool interface with vendor-specific file
 * generation and build-target detection.
 */
export interface SynthesisToolchain extends LaunchableTool {
  /**
   * Subdirectory under the IP output dir where this vendor's files live.
   * E.g. 'xilinx' for Vivado, 'altera' for Quartus.
   */
  readonly outputSubdir: string;

  /**
   * VS Code context key toggled by ToolDetector so menu items are shown/hidden.
   * E.g. 'ipcraft.vivadoFound', 'ipcraft.quartusFound'.
   */
  readonly contextKey: string;

  /**
   * Generate vendor-specific files (packaging + optional project TCL) and
   * return them as a { relPath → content } map. Relative paths are under
   * `outputSubdir/`.
   */
  scaffold(ctx: ScaffoldContext, opts: ScaffoldOptions): Record<string, string>;

  /**
   * Probe the IP directory for available build targets. Returns an empty array
   * when no runnable scripts are found.
   */
  detectBuildModes(
    name: string,
    ipDir: string,
    cfg: vscode.WorkspaceConfiguration,
    outputChannel: vscode.OutputChannel
  ): Promise<BuildMode[]>;

  /**
   * Run only the project-setup TCL (no synthesis/compile) so the resulting
   * vendor project file (.xpr / .qpf) is available for opening in the IDE GUI.
   *
   * Returns true on success, false when the TCL script is missing, the tool
   * cannot be resolved, or the launch itself fails.
   */
  createProject(
    name: string,
    ipDir: string,
    cfg: vscode.WorkspaceConfiguration,
    outputChannel: vscode.OutputChannel
  ): Promise<boolean>;
}
