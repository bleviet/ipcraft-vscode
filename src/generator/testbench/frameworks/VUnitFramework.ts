import type { Engine } from '../Engine';
import type { Framework, TestbenchContext } from '../Framework';

export class VUnitFramework implements Framework {
  readonly id = 'vunit';
  readonly displayName = 'VUnit';

  generate(ctx: TestbenchContext, engine: Engine): Record<string, string> {
    const { name, templateContext, templates, hasMmSlave } = ctx;
    const extraCompileArgs = ctx.extraCompileArgs ?? [];
    const extraSimArgs = ctx.extraSimArgs ?? [];
    const extraEnv = ctx.extraEnv ?? {};

    const vunitCtx = {
      ...templateContext,
      engine_sim_var: engine.simVar,
      engine_compile_args: [...engine.compileArgs, ...extraCompileArgs],
      engine_extra_sim_args: extraSimArgs,
      engine_extra_env: Object.entries(extraEnv).map(([k, v]) => ({ key: k, value: v })),
      engine_vunit_sim_option_key: engine.vunitSimOptionKey,
      engine_vunit_compile_option_key: engine.vunitCompileOptionKey,
      has_memory_mapped_slave: hasMmSlave,
    };

    return {
      'tb/run.py': templates.render('vunit_run.py.j2', vunitCtx),
      [`tb/${name}_tb.vhd`]: templates.render('vunit_tb.vhd.j2', vunitCtx),
      '.vscode/settings.json': templates.render('vscode_settings.json.j2', templateContext),
    };
  }
}
