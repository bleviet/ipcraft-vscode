import type { Engine } from '../Engine';

export class VerilatorEngine implements Engine {
  readonly id = 'verilator';
  readonly displayName = 'Verilator';
  readonly simVar = 'verilator';
  readonly topLevelLang = 'verilog' as const;
  readonly compileArgs = ['--sv', '-Wno-fatal', '--trace-fst'];
  readonly waveExt = 'fst';
  readonly vunitSimOptionKey = 'ghdl.elab_flags'; // not applicable
  readonly vunitCompileOptionKey = 'ghdl.a_flags'; // not applicable
  readonly cocotbCompileVar = 'COMPILE_ARGS';

  simArgs(_entityName: string): string[] {
    return [];
  }

  waveArgs(entityName: string): string[] {
    return [`--trace-fst`, `--trace-file ${entityName}.fst`];
  }

  waveViewerCmd(entityName: string): string {
    return `gtkwave ${entityName}.fst &`;
  }
}
