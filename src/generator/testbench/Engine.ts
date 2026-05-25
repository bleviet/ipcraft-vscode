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
}
