import type { Engine } from '../Engine';

export class IcarusEngine implements Engine {
  readonly id = 'icarus';
  readonly displayName = 'Icarus Verilog';
  readonly simVar = 'icarus';
  readonly topLevelLang = 'verilog' as const;
  readonly compileArgs = ['-g2012'];
  readonly waveExt = 'vcd';
  readonly vunitSimOptionKey = 'ghdl.elab_flags'; // not used for icarus in VUnit
  readonly vunitCompileOptionKey = 'ghdl.a_flags'; // not used for icarus in VUnit
  readonly cocotbCompileVar = 'COMPILE_ARGS';

  simArgs(_entityName: string): string[] {
    return [];
  }

  waveArgs(entityName: string): string[] {
    return [`-vcd ${entityName}.vcd`];
  }

  waveViewerCmd(entityName: string): string {
    return `gtkwave ${entityName}.vcd &`;
  }
}
