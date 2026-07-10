/** Simulation engine abstraction — owns compile/sim flags and wave output format. */
export interface Engine {
  readonly id: string;
  readonly displayName: string;
  /** Value for the SIM make/runner variable (e.g. 'ghdl', 'icarus'). */
  readonly simVar: string;
  /** HDL language this engine targets: 'vhdl' or 'verilog'. */
  readonly topLevelLang: 'vhdl' | 'verilog';
  /** Compile-time flags (e.g. --std=08). */
  readonly compileArgs: string[];
  /** Simulation-time flags. Entity name provided for wave file naming. */
  simArgs(entityName: string): string[];
  /** Waveform output arguments. Empty array = no waveforms. */
  waveArgs(entityName: string): string[];
  /** Extension of the waveform output file (e.g. 'ghw', 'vcd', 'fst'). */
  readonly waveExt: string;
  /** VUnit sim option key for this engine (e.g. 'ghdl.elab_flags'). */
  readonly vunitSimOptionKey: string;
  /** VUnit compile option key for this engine (e.g. 'ghdl.a_flags'). */
  readonly vunitCompileOptionKey: string;
  /**
   * cocotb Makefile variable that receives compile-time flags.
   * Most engines use COMPILE_ARGS; Questa uses VCOM_ARGS (VHDL) or VLOG_ARGS (SV).
   */
  readonly cocotbCompileVar: string;
  /**
   * cocotb Makefile variable that must repeat the same flags at run time (e.g. `ghdl -r`).
   * GHDL's mcode backend names its elaborated work library by `--std`
   * (`work-obj08.cf` vs `work-obj93.cf`); without repeating `--std=08` at run time via
   * EXTRA_ARGS (which feeds GHDL_ARGS, applied to both analyse and run), `ghdl -r` looks
   * for the default-std library and fails with "cannot find entity or configuration".
   * Undefined when the engine's compile flags are compile-only (Icarus, Verilator, Questa).
   */
  readonly cocotbRunArgsVar?: string;
  /** Shell command to open the waveform file produced by this engine. */
  waveViewerCmd(entityName: string): string;
}
