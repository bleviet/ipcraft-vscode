import type { Engine } from '../Engine';
import type { Framework, TestbenchContext } from '../Framework';

const RTL_HDL_TYPES = new Set(['vhdl', 'systemverilog', 'verilog']);
const SIM_PREFIXES = ['tb/', 'sim/', 'simulation/', 'testbench/', 'test/'];

function isSimPath(p: string): boolean {
  return SIM_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/**
 * Assigns a compile-order rank based on file-name suffix convention.
 * Lower rank = must be compiled first.
 *   0  _pkg.*      — shared-types package
 *   1  _regs.*     — generated register file (uses package)
 *   2  _core.*     — user logic stub (uses package + regs)
 *   3  _<bus>.*    — bus wrapper (axil/avmm/axi4/…) instantiates core
 *   4  everything else (top-level entity or unknown)
 */
function hdlCompileRank(filePath: string): number {
  const base = filePath.split('/').pop()?.toLowerCase() ?? '';
  if (/_pkg\.(vhd|sv|v)$/.test(base)) {
    return 0;
  }
  if (/_regs\.(vhd|sv|v)$/.test(base)) {
    return 1;
  }
  if (/_core\.(vhd|sv|v)$/.test(base)) {
    return 2;
  }
  if (/_(?:axil|avmm|axi4|axi3|apb|wishbone|ahb)\.(vhd|sv|v)$/.test(base)) {
    return 3;
  }
  return 4;
}

export class CocotbFramework implements Framework {
  readonly id = 'cocotb';
  readonly displayName = 'CocoTB';

  generate(ctx: TestbenchContext, engine: Engine): Record<string, string> {
    const { name, templateContext, templates, isSv, hasMmSlave } = ctx;
    const extraCompileArgs = ctx.extraCompileArgs ?? [];
    const extraSimArgs = ctx.extraSimArgs ?? [];
    const extraEnv = ctx.extraEnv ?? {};
    const files: Record<string, string> = {};

    // Derive RTL source file list from ip.yml fileSets when available.
    const hdlFiles = (ctx.fileSets ?? [])
      .flatMap((fs) => fs.files ?? [])
      .filter((f) => RTL_HDL_TYPES.has(f.type) && !isSimPath(f.path));

    const rtlSourceFiles = hdlFiles
      .filter((f) => !f.isIncludeFile)
      .slice()
      .sort((a, b) => hdlCompileRank(a.path) - hdlCompileRank(b.path))
      .map((f) => f.path);
    const includeDirSet = new Set(
      hdlFiles
        .filter((f) => f.isIncludeFile)
        .map((f) => (f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : '.'))
    );
    const rtlIncludeDirs = [...includeDirSet];

    // Base context shared across all cocotb templates (conftest, test, Makefile).
    const cocotbCtx = {
      ...templateContext,
      is_sv: isSv,
      rtl_source_files: rtlSourceFiles,
      rtl_include_dirs: rtlIncludeDirs,
    };

    // Extend the template context with engine-specific values so templates can
    // consume them directly instead of relying solely on ifeq blocks.
    const makeCtx = {
      ...cocotbCtx,
      engine_sim_var: engine.simVar,
      engine_compile_args: engine.compileArgs.join(' '),
      engine_wave_ext: engine.waveExt,
      engine_top_level_lang: engine.topLevelLang,
      engine_extra_compile_args: extraCompileArgs.join(' '),
      engine_extra_sim_args: extraSimArgs.join(' '),
      engine_extra_env: Object.entries(extraEnv).map(([k, v]) => ({ key: k, value: v })),
    };

    if (hasMmSlave) {
      files['tb/mm_loader.py'] = templates.render('mm_loader.py.j2', templateContext);
    }
    files[`tb/${name}_test.py`] = templates.render('cocotb_test.py.j2', templateContext);
    files['tb/conftest.py'] = templates.render('cocotb_conftest.py.j2', cocotbCtx);
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
