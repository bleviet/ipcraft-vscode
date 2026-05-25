import type { Engine } from '../Engine';

export class QuestaEngine implements Engine {
  readonly id = 'questa';
  readonly displayName = 'Questa / ModelSim';
  readonly simVar = 'questa';
  readonly topLevelLang = 'vhdl' as const;
  readonly compileArgs = ['-2008'];
  readonly waveExt = 'wlf';
  readonly vunitSimOptionKey = 'modelsim.vsim_flags';
  readonly vunitCompileOptionKey = 'modelsim.vcom_flags';

  simArgs(_entityName: string): string[] {
    return ['-do', 'run -all; quit'];
  }

  waveArgs(entityName: string): string[] {
    return [`-wlf ${entityName}.wlf`];
  }
}
