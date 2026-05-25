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
