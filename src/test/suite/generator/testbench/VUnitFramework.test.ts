import * as path from 'path';
import { VUnitFramework } from '../../../../generator/testbench/frameworks/VUnitFramework';
import { GhdlEngine } from '../../../../generator/testbench/engines/GhdlEngine';
import { QuestaEngine } from '../../../../generator/testbench/engines/QuestaEngine';
import { TemplateLoader } from '../../../../generator/TemplateLoader';
import { Logger } from '../../../../utils/Logger';
import type { TestbenchContext } from '../../../../generator/testbench/Framework';

jest.mock('../../../../utils/Logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

const TEMPLATES_PATH = path.resolve(__dirname, '../../../../generator/templates');
const logger = new Logger('test');
const templates = new TemplateLoader(logger, TEMPLATES_PATH);

function makeCtx(overrides: Partial<TestbenchContext> = {}): TestbenchContext {
  return {
    name: 'my_core',
    templates,
    isSv: false,
    hasMmSlave: false,
    templateContext: {
      entity_name: 'my_core',
      clock_port: 'clk',
      reset_port: 'rst_n',
      reset_active_high: false,
      bus_type: 'none',
      has_memory_mapped_slave: false,
      ports: [{ name: 'i_data', direction: 'in', width: 8 }],
      parameters: [],
    },
    ...overrides,
  };
}

describe('VUnitFramework', () => {
  const framework = new VUnitFramework();

  it('emits run.py, the VHDL testbench, and vscode/settings.json', () => {
    const files = framework.generate(makeCtx(), new GhdlEngine());
    expect(Object.keys(files)).toContain('tb/run.py');
    expect(Object.keys(files)).toContain('tb/my_core_tb.vhd');
    expect(Object.keys(files)).toContain('.vscode/settings.json');
    // No Makefile or conftest for VUnit
    expect(Object.keys(files)).not.toContain('tb/Makefile');
    expect(Object.keys(files)).not.toContain('tb/conftest.py');
  });

  it('run.py references RTL sources in correct order for plain VHDL', () => {
    const runPy = framework.generate(makeCtx(), new GhdlEngine())['tb/run.py'];
    expect(runPy).toContain('my_core.vhd');
    expect(runPy).toContain('my_core_tb.vhd');
    // VUnit from_argv pattern
    expect(runPy).toContain('VUnit.from_argv()');
    expect(runPy).toContain('vu.main()');
  });

  it('run.py includes RTL packages before top-level entity when has_memory_mapped_slave', () => {
    const ctx = makeCtx({
      hasMmSlave: true,
      templateContext: {
        entity_name: 'my_core',
        clock_port: 'clk',
        reset_port: 'rst_n',
        reset_active_high: false,
        bus_type: 'axil',
        has_memory_mapped_slave: true,
        memmap_relpath: '../my_core.mmap.yml',
        ports: [],
        parameters: [],
      },
    });
    const runPy = framework.generate(ctx, new GhdlEngine())['tb/run.py'];
    const pkgIdx = runPy.indexOf('my_core_pkg.vhd');
    const topIdx = runPy.indexOf('my_core.vhd');
    expect(pkgIdx).toBeGreaterThan(-1);
    expect(topIdx).toBeGreaterThan(pkgIdx);
  });

  it('GHDL engine compile flags appear in run.py', () => {
    const engine = new GhdlEngine();
    const runPy = framework.generate(makeCtx(), engine)['tb/run.py'];
    expect(runPy).toContain('ghdl.a_flags');
    expect(runPy).toContain('--std=08');
    expect(runPy).toContain('-frelaxed');
  });

  it('Questa engine sim option key appears in run.py for questa engine', () => {
    const engine = new QuestaEngine();
    const runPy = framework.generate(makeCtx(), engine)['tb/run.py'];
    expect(runPy).toContain('modelsim.vcom_flags');
  });

  it('VHDL testbench has VUnit context and runner_cfg generic', () => {
    const tb = framework.generate(makeCtx(), new GhdlEngine())['tb/my_core_tb.vhd'];
    expect(tb).toContain('library vunit_lib');
    expect(tb).toContain('context vunit_lib.vunit_context');
    expect(tb).toContain('runner_cfg : string');
    expect(tb).toContain('test_runner_setup(runner, runner_cfg)');
    expect(tb).toContain('test_runner_cleanup(runner)');
  });

  it('VHDL testbench entity name matches core name', () => {
    const tb = framework.generate(makeCtx(), new GhdlEngine())['tb/my_core_tb.vhd'];
    expect(tb).toContain('entity my_core_tb is');
    expect(tb).toContain('entity work.my_core');
  });

  it('appends extraCompileArgs to engine flags and exports extraEnv in run.py', () => {
    const runPy = framework.generate(
      makeCtx({
        extraCompileArgs: ['-fexplicit'],
        extraEnv: { MY_LIC: '/tmp/lic.dat' },
      }),
      new GhdlEngine()
    )['tb/run.py'];
    expect(runPy).toContain('-fexplicit');
    expect(runPy).toContain('os.environ.setdefault("MY_LIC", "/tmp/lic.dat")');
  });
});

describe('VUnitFramework — SystemVerilog variant', () => {
  const framework = new VUnitFramework();

  function makeSvCtx(overrides: Partial<TestbenchContext> = {}): TestbenchContext {
    return makeCtx({
      isSv: true,
      templateContext: {
        entity_name: 'my_core',
        clock_port: 'clk',
        reset_port: 'rst_n',
        reset_active_high: false,
        bus_type: 'none',
        has_memory_mapped_slave: false,
        ports: [{ name: 'i_data', direction: 'in', width: 8 }],
        parameters: [],
      },
      ...overrides,
    });
  }

  it('emits _tb.sv instead of _tb.vhd when isSv is true', () => {
    const files = framework.generate(makeSvCtx(), new QuestaEngine());
    expect(Object.keys(files)).toContain('tb/my_core_tb.sv');
    expect(Object.keys(files)).not.toContain('tb/my_core_tb.vhd');
    expect(Object.keys(files)).toContain('tb/run.py');
    expect(Object.keys(files)).toContain('.vscode/settings.json');
  });

  it('SV testbench uses SystemVerilog module syntax', () => {
    const tb = framework.generate(makeSvCtx(), new QuestaEngine())['tb/my_core_tb.sv'];
    expect(tb).toContain('module my_core_tb');
    expect(tb).toContain('endmodule');
    expect(tb).toContain('import vunit_pkg::*');
    expect(tb).toContain('test_runner_setup');
    expect(tb).toContain('test_runner_cleanup');
  });

  it('run.py references .sv RTL sources and _tb.sv when isSv is true', () => {
    const runPy = framework.generate(makeSvCtx(), new QuestaEngine())['tb/run.py'];
    expect(runPy).toContain('my_core.sv');
    expect(runPy).toContain('my_core_tb.sv');
    expect(runPy).not.toContain('my_core.vhd');
    expect(runPy).not.toContain('my_core_tb.vhd');
  });

  it('run.py uses add_verilog_include_dir instead of add_vhdl_builtins for SV', () => {
    const runPy = framework.generate(makeSvCtx(), new QuestaEngine())['tb/run.py'];
    expect(runPy).toContain('add_verilog_include_dir');
    expect(runPy).not.toContain('add_vhdl_builtins');
  });

  it('run.py still references .vhd when isSv is false', () => {
    const runPy = framework.generate(makeCtx(), new GhdlEngine())['tb/run.py'];
    expect(runPy).toContain('my_core.vhd');
    expect(runPy).toContain('my_core_tb.vhd');
    expect(runPy).toContain('add_vhdl_builtins');
  });
});

describe('VUnitFramework — fileset-driven sources', () => {
  const framework = new VUnitFramework();

  function makeFilesetCtx(overrides: Partial<TestbenchContext> = {}): TestbenchContext {
    return makeCtx({
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [
            { path: 'rtl/my_core_pkg.vhd', type: 'vhdl' },
            { path: 'rtl/my_core_regs.vhd', type: 'vhdl' },
            { path: 'rtl/my_core.vhd', type: 'vhdl' },
          ],
        },
        {
          name: 'Simulation_Resources',
          files: [
            { path: 'tb/my_core_tb.vhd', type: 'vhdl' },
            { path: 'tb/Makefile', type: 'unknown' },
          ],
        },
      ],
      ...overrides,
    });
  }

  it('run.py lists each fileset RTL source file when fileSets is provided', () => {
    const runPy = framework.generate(makeFilesetCtx(), new GhdlEngine())['tb/run.py'];
    expect(runPy).toContain('BASE_DIR / "rtl/my_core_pkg.vhd"');
    expect(runPy).toContain('BASE_DIR / "rtl/my_core_regs.vhd"');
    expect(runPy).toContain('BASE_DIR / "rtl/my_core.vhd"');
  });

  it('run.py does not add tb/ files from fileSets as RTL sources', () => {
    const runPy = framework.generate(makeFilesetCtx(), new GhdlEngine())['tb/run.py'];
    // tb/my_core_tb.vhd is in Simulation_Resources — should not appear in lib.add_source_files twice
    const matches = [...runPy.matchAll(/BASE_DIR \/ "tb\/my_core_tb\.vhd"/g)];
    expect(matches.length).toBe(0);
  });

  it('run.py still adds the testbench file from TB_DIR explicitly', () => {
    const runPy = framework.generate(makeFilesetCtx(), new GhdlEngine())['tb/run.py'];
    expect(runPy).toContain('TB_DIR / "my_core_tb.vhd"');
  });

  it('run.py skips hardcoded entity-name fallback when fileSets is provided', () => {
    const runPy = framework.generate(makeFilesetCtx(), new GhdlEngine())['tb/run.py'];
    // Fallback pattern would produce this (no explicit pkg listed)
    expect(runPy).not.toContain('rtl/{{ entity_name }}');
    // Uses BASE_DIR, not RTL_DIR
    expect(runPy).not.toContain('RTL_DIR');
  });

  it('run.py adds verilog_include_dir for each SV include file parent dir', () => {
    const ctx = makeCtx({
      isSv: true,
      fileSets: [
        {
          name: 'RTL_Sources',
          files: [
            { path: 'include/my_pkg.svh', type: 'systemverilog', isIncludeFile: true },
            { path: 'rtl/my_core.sv', type: 'systemverilog' },
          ],
        },
      ],
    });
    const runPy = framework.generate(ctx, new QuestaEngine())['tb/run.py'];
    expect(runPy).toContain('add_verilog_include_dir(str(BASE_DIR / "include"))');
    expect(runPy).toContain('BASE_DIR / "rtl/my_core.sv"');
    // Include file itself should not appear in lib.add_source_files
    expect(runPy).not.toContain('BASE_DIR / "include/my_pkg.svh"');
  });

  it('run.py falls back to entity-name logic when fileSets is empty', () => {
    const runPy = framework.generate(makeCtx({ fileSets: [] }), new GhdlEngine())['tb/run.py'];
    expect(runPy).toContain('BASE_DIR / "rtl/my_core.vhd"');
  });

  it('uses BASE_DIR variable pointing to project root in all paths', () => {
    const runPy = framework.generate(makeFilesetCtx(), new GhdlEngine())['tb/run.py'];
    expect(runPy).toContain('BASE_DIR = Path(__file__).parent.parent');
    expect(runPy).not.toContain('RTL_DIR');
  });
});
