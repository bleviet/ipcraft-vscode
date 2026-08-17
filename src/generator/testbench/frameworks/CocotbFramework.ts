import type { Engine } from '../Engine';
import type { Framework, TestbenchContext } from '../Framework';
import { buildVerificationManifest } from '../../verificationManifest';

const RTL_HDL_TYPES = new Set(['vhdl', 'systemverilog', 'verilog']);
const SIM_PREFIXES = ['tb/', 'sim/', 'simulation/', 'testbench/', 'test/'];

function isSimPath(p: string): boolean {
  return SIM_PREFIXES.some((prefix) => p.startsWith(prefix));
}

interface AvalonSignalContext {
  name: string;
  asserted: 0 | 1;
  deasserted: 0 | 1;
  active_low: boolean;
}

interface AvalonTransportContext {
  address: AvalonSignalContext;
  byte_enable: AvalonSignalContext;
  read: AvalonSignalContext;
  read_data: AvalonSignalContext;
  read_data_valid: AvalonSignalContext;
  wait_request: AvalonSignalContext;
  write: AvalonSignalContext;
  write_data: AvalonSignalContext;
}

function buildAvalonTransportContext(
  templateContext: Record<string, unknown>
): AvalonTransportContext {
  const prefix = String(templateContext.bus_prefix ?? '');
  const ports = Array.isArray(templateContext.bus_ports)
    ? (templateContext.bus_ports as Array<Record<string, unknown>>)
    : [];
  const resolve = (logicalName: string): AvalonSignalContext => {
    const port = ports.find(
      (candidate) =>
        String(candidate.logical_name ?? '').toLowerCase() === logicalName.toLowerCase()
    );
    const activeLow = port?.effective_polarity === 'activeLow';
    return {
      name: typeof port?.name === 'string' ? port.name : `${prefix}_${logicalName}`,
      asserted: activeLow ? 0 : 1,
      deasserted: activeLow ? 1 : 0,
      active_low: activeLow,
    };
  };

  return {
    address: resolve('address'),
    byte_enable: resolve('byteenable'),
    read: resolve('read'),
    read_data: resolve('readdata'),
    read_data_valid: resolve('readdatavalid'),
    wait_request: resolve('waitrequest'),
    write: resolve('write'),
    write_data: resolve('writedata'),
  };
}

export class CocotbFramework implements Framework {
  readonly id = 'cocotb';
  readonly displayName = 'CocoTB';

  generate(ctx: TestbenchContext, engine: Engine): Record<string, string> {
    const { name, templateContext, templates, isSv, hasMmSlave } = ctx;
    const topLevel = ctx.topLevel ?? name;
    const extraCompileArgs = ctx.extraCompileArgs ?? [];
    const extraSimArgs = ctx.extraSimArgs ?? [];
    const extraEnv = ctx.extraEnv ?? {};
    const files: Record<string, string> = {};

    // RTL sources to compile come from the caller-resolved rtlSourceFiles (the union of
    // generated + hand-authored fileSets files, in compile order); fileSets is only
    // consulted here for include-file search directories.
    const rtlSourceFiles = ctx.rtlSourceFiles ?? [];
    const includeDirSet = new Set(
      (ctx.fileSets ?? [])
        .flatMap((fs) => fs.files ?? [])
        .filter((f) => RTL_HDL_TYPES.has(f.type) && f.isIncludeFile && !isSimPath(f.path))
        .map((f) => (f.path.includes('/') ? f.path.substring(0, f.path.lastIndexOf('/')) : '.'))
    );
    const rtlIncludeDirs = [...includeDirSet];

    // Base context shared across all cocotb templates (conftest, test, Makefile).
    const cocotbCtx = {
      ...templateContext,
      is_sv: isSv,
      rtl_source_files: rtlSourceFiles,
      rtl_include_dirs: rtlIncludeDirs,
      top_level: topLevel,
    };
    const testCtx = {
      ...cocotbCtx,
      avmm_signals: buildAvalonTransportContext(templateContext),
    };

    // Extend the template context with engine-specific values so templates can
    // consume them directly without engine-name ifeq blocks.
    const makeCtx = {
      ...cocotbCtx,
      engine_sim_var: engine.simVar,
      engine_display_name: engine.displayName,
      engine_compile_args: engine.compileArgs.join(' '),
      engine_cocotb_compile_var: engine.cocotbCompileVar,
      engine_cocotb_run_args_var: engine.cocotbRunArgsVar,
      engine_wave_ext: engine.waveExt,
      engine_wave_args: engine.waveArgs(name),
      engine_wave_viewer_cmd: engine.waveViewerCmd(name),
      engine_top_level_lang: engine.topLevelLang,
      engine_extra_compile_args: extraCompileArgs.join(' '),
      engine_extra_sim_args: extraSimArgs.join(' '),
      engine_extra_env: Object.entries(extraEnv).map(([k, v]) => ({ key: k, value: v })),
    };

    if (hasMmSlave) {
      const busPorts = Array.isArray(templateContext.bus_ports)
        ? (templateContext.bus_ports as Array<Record<string, unknown>>)
        : [];
      const byteEnableSupported = busPorts.some((port) =>
        ['WSTRB', 'byteenable'].includes(String(port.logical_name))
      );
      const manifest = buildVerificationManifest(ctx.memoryMaps ?? [], {
        busType: String(templateContext.bus_type ?? ''),
        dataWidth: Number(templateContext.data_width ?? 32),
        byteEnableSupported,
      });
      files['tb/verification_manifest.json'] = `${JSON.stringify(manifest, null, 2)}\n`;
      files['tb/register_model.py'] = templates.render('register_model.py.j2', templateContext);
    }
    files[`tb/${name}_test.py`] = templates.render('cocotb_test.py.j2', testCtx);
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
