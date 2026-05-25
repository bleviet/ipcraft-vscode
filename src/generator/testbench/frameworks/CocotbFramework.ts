import type { Engine } from '../Engine';
import type { Framework, TestbenchContext } from '../Framework';

export class CocotbFramework implements Framework {
  readonly id = 'cocotb';
  readonly displayName = 'CocoTB';

  generate(ctx: TestbenchContext, engine: Engine): Record<string, string> {
    const { name, templateContext, templates, isSv, hasMmSlave } = ctx;
    const files: Record<string, string> = {};

    // Extend the template context with engine-specific values so templates can
    // consume them directly instead of relying solely on ifeq blocks.
    const makeCtx = {
      ...templateContext,
      engine_sim_var: engine.simVar,
      engine_compile_args: engine.compileArgs.join(' '),
      engine_wave_ext: engine.waveExt,
      engine_top_level_lang: engine.topLevelLang,
    };

    if (hasMmSlave) {
      files['tb/mm_loader.py'] = templates.render('mm_loader.py.j2', templateContext);
    }
    files[`tb/${name}_test.py`] = templates.render('cocotb_test.py.j2', templateContext);
    files['tb/conftest.py'] = templates.render('cocotb_conftest.py.j2', templateContext);
    files[`tb/test_${name}_sim.py`] = templates.render('cocotb_pytest.py.j2', templateContext);
    files['tb/Makefile'] = templates.render(
      isSv ? 'cocotb_makefile.sv.j2' : 'cocotb_makefile.j2',
      makeCtx
    );
    if (isSv) {
      files['tb/dump.v'] = templates.render('cocotb_dump.v.j2', templateContext);
    }
    files['.vscode/settings.json'] = templates.render('vscode_settings.json.j2', templateContext);

    return files;
  }
}
