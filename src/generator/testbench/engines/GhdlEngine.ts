import type { Engine } from '../Engine';

export class GhdlEngine implements Engine {
  readonly id = 'ghdl';
  readonly displayName = 'GHDL';
  readonly simVar = 'ghdl';
  readonly topLevelLang = 'vhdl' as const;
  readonly compileArgs = ['--std=08', '-frelaxed'];
  readonly waveExt = 'ghw';
  readonly vunitSimOptionKey = 'ghdl.elab_flags';
  readonly vunitCompileOptionKey = 'ghdl.a_flags';
  readonly cocotbCompileVar = 'COMPILE_ARGS';

  simArgs(entityName: string): string[] {
    return [`--wave=${entityName}.ghw`];
  }

  waveArgs(entityName: string): string[] {
    return [`--wave=${entityName}.ghw`];
  }

  waveViewerCmd(entityName: string): string {
    return `gtkwave ${entityName}.ghw &`;
  }
}
