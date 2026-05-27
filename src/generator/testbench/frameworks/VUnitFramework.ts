import type { Engine } from '../Engine';
import type { Framework, TestbenchContext } from '../Framework';

const RTL_HDL_TYPES = new Set(['vhdl', 'systemverilog', 'verilog']);
const SIM_PREFIXES = ['tb/', 'sim/', 'simulation/', 'testbench/', 'test/'];

function isSimPath(p: string): boolean {
  return SIM_PREFIXES.some((prefix) => p.startsWith(prefix));
}

export class VUnitFramework implements Framework {
  readonly id = 'vunit';
  readonly displayName = 'VUnit';

  generate(ctx: TestbenchContext, engine: Engine): Record<string, string> {
    const { name, templateContext, templates, isSv, hasMmSlave } = ctx;
    const extraCompileArgs = ctx.extraCompileArgs ?? [];
    const extraSimArgs = ctx.extraSimArgs ?? [];
    const extraEnv = ctx.extraEnv ?? {};

    // Derive RTL source file list from ip.yml fileSets when available.
    const hdlFiles = (ctx.fileSets ?? [])
      .flatMap((fs) => fs.files ?? [])
      .filter((f) => RTL_HDL_TYPES.has(f.type) && !isSimPath(f.path));

    const rtlSourceFiles = hdlFiles.filter((f) => !f.isIncludeFile).map((f) => f.path);
    const includeDirSet = new Set(
      hdlFiles
        .filter((f) => f.isIncludeFile)
        .map((f) => (f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : '.'))
    );
    const rtlIncludeDirs = [...includeDirSet];

    const vunitCtx = {
      ...templateContext,
      is_sv: isSv,
      engine_sim_var: engine.simVar,
      engine_compile_args: [...engine.compileArgs, ...extraCompileArgs],
      engine_extra_sim_args: extraSimArgs,
      engine_extra_env: Object.entries(extraEnv).map(([k, v]) => ({ key: k, value: v })),
      engine_vunit_sim_option_key: engine.vunitSimOptionKey,
      engine_vunit_compile_option_key: engine.vunitCompileOptionKey,
      has_memory_mapped_slave: hasMmSlave,
      rtl_source_files: rtlSourceFiles,
      rtl_include_dirs: rtlIncludeDirs,
    };

    const tbFile = isSv ? `tb/${name}_tb.sv` : `tb/${name}_tb.vhd`;
    const tbTemplate = isSv ? 'vunit_tb.sv.j2' : 'vunit_tb.vhd.j2';

    return {
      'tb/run.py': templates.render('vunit_run.py.j2', vunitCtx),
      [tbFile]: templates.render(tbTemplate, vunitCtx),
      '.vscode/settings.json': templates.render('vscode_settings.json.j2', templateContext),
    };
  }
}
