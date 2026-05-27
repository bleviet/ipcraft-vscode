import type * as vscode from 'vscode';

export interface ResolvedExecutable {
  exe: string;
  prefixArgs: string[];
}

export interface ExtraMountSpec {
  host: string;
  container: string;
  ro?: boolean;
}

export interface LaunchEnv {
  env: Record<string, string>;
  extraMounts: ExtraMountSpec[];
}

export interface DockerConfig {
  image: string;
  mountBase: string;
}

/**
 * A companion executable that lives inside the same toolchain installation but
 * has its own VS Code context key (e.g. `qsys-edit` inside Quartus).
 */
export interface SubToolDeclaration {
  /** Executable name used for PATH / installDir lookup (e.g. 'qsys-edit'). */
  readonly name: string;
  /** VS Code context key toggled by ToolDetector (e.g. 'ipcraft.qsysEditFound'). */
  readonly contextKey: string;
}

/**
 * Common interface for any externally-invoked FPGA tool (synthesis vendor or
 * simulator engine). Handles executable resolution, Docker configuration, and
 * environment / mount injection for license-server scenarios.
 */
export interface LaunchableTool {
  readonly id: string;
  readonly displayName: string;

  /**
   * Companion executables that belong to this toolchain but require their own
   * VS Code context key. ToolDetector iterates over this list so each sub-tool
   * can be detected generically without special-casing in the detector.
   */
  readonly subTools: ReadonlyArray<SubToolDeclaration>;

  /**
   * Resolve the executable path for a named sub-tool (e.g. 'vivado', 'quartus_sh',
   * 'vsim'). Returns null when the tool cannot be located.
   */
  resolve(subTool: string, cfg: vscode.WorkspaceConfiguration): ResolvedExecutable | null;

  /**
   * Build the Docker configuration for batch runs, or undefined when running locally.
   * `mountBase` is the primary directory that will be mounted as /work.
   */
  getDocker(cfg: vscode.WorkspaceConfiguration, mountBase: string): DockerConfig | undefined;

  /**
   * Build the environment variable overlay and extra Docker mounts needed for
   * this tool (e.g. LM_LICENSE_FILE, MODEL_TECH, /opt/licenses mount).
   */
  getLaunchEnv(cfg: vscode.WorkspaceConfiguration): LaunchEnv;

  /** Return true when this tool is reachable (installDir / PATH / Docker image). */
  isAvailable(cfg: vscode.WorkspaceConfiguration): boolean;

  /**
   * Return true when the named sub-tool (from `subTools`) is reachable.
   * Implementations apply the same installDir / Docker / PATH heuristics as
   * `isAvailable`, but scoped to the specific sub-tool executable.
   */
  isSubToolAvailable(toolName: string, cfg: vscode.WorkspaceConfiguration): boolean;
}
