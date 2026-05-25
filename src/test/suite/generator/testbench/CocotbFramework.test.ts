import * as path from 'path';
import { CocotbFramework } from '../../../../generator/testbench/frameworks/CocotbFramework';
import { GhdlEngine } from '../../../../generator/testbench/engines/GhdlEngine';
import { IcarusEngine } from '../../../../generator/testbench/engines/IcarusEngine';
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
    name: 'test_core',
    templates,
    isSv: false,
    hasMmSlave: false,
    templateContext: {
      entity_name: 'test_core',
      clock_port: 'clk',
      reset_port: 'rst_n',
      reset_active_high: false,
      bus_type: 'none',
      has_memory_mapped_slave: false,
      ports: [],
      parameters: [],
    },
    ...overrides,
  };
}

describe('CocotbFramework', () => {
  const framework = new CocotbFramework();

  it('emits the 5 standard files for VHDL + no MM slave', () => {
    const files = framework.generate(makeCtx(), new GhdlEngine());
    expect(Object.keys(files)).toContain('tb/test_core_test.py');
    expect(Object.keys(files)).toContain('tb/conftest.py');
    expect(Object.keys(files)).toContain('tb/test_test_core_sim.py');
    expect(Object.keys(files)).toContain('tb/Makefile');
    expect(Object.keys(files)).toContain('.vscode/settings.json');
    // mm_loader only for MM slave
    expect(Object.keys(files)).not.toContain('tb/mm_loader.py');
    // dump.v only for SV
    expect(Object.keys(files)).not.toContain('tb/dump.v');
  });

  it('emits mm_loader.py when hasMmSlave is true', () => {
    const files = framework.generate(
      makeCtx({
        hasMmSlave: true,
        templateContext: {
          entity_name: 'test_core',
          clock_port: 'clk',
          reset_port: 'rst_n',
          reset_active_high: false,
          bus_type: 'axil',
          has_memory_mapped_slave: true,
          memmap_relpath: '../test_core.mmap.yml',
          ports: [],
          parameters: [],
        },
      }),
      new GhdlEngine()
    );
    expect(Object.keys(files)).toContain('tb/mm_loader.py');
  });

  it('emits dump.v for SV + Icarus and sets verilog Makefile', () => {
    const files = framework.generate(
      makeCtx({
        isSv: true,
        templateContext: {
          entity_name: 'test_core',
          clock_port: 'clk',
          reset_port: 'rst_n',
          reset_active_high: false,
          bus_type: 'none',
          has_memory_mapped_slave: false,
          ports: [],
          parameters: [],
        },
      }),
      new IcarusEngine()
    );
    expect(Object.keys(files)).toContain('tb/dump.v');
    // Makefile should be rendered from sv template
    expect(files['tb/Makefile']).toContain('VERILOG_SOURCES');
  });

  it('injects engine_sim_var into the Makefile context (GHDL)', () => {
    const files = framework.generate(makeCtx(), new GhdlEngine());
    // The VHDL makefile template uses SIM ?= ghdl
    expect(files['tb/Makefile']).toContain('ghdl');
  });

  it('injects engine_sim_var for Icarus into SV Makefile', () => {
    const files = framework.generate(
      makeCtx({
        isSv: true,
        templateContext: {
          entity_name: 'test_core',
          clock_port: 'clk',
          reset_port: 'rst_n',
          reset_active_high: false,
          bus_type: 'none',
          has_memory_mapped_slave: false,
          ports: [],
          parameters: [],
        },
      }),
      new IcarusEngine()
    );
    expect(files['tb/Makefile']).toContain('icarus');
  });

  it('forwards extraCompileArgs, extraSimArgs and extraEnv into Makefile', () => {
    const files = framework.generate(
      makeCtx({
        extraCompileArgs: ['-fsynopsys', '-Wno-hide'],
        extraSimArgs: ['--stop-time=1us'],
        extraEnv: { MY_FLAG: 'on', LM_LICENSE_FILE: '/opt/licenses/x.dat' },
      }),
      new GhdlEngine()
    );
    const mk = files['tb/Makefile'];
    expect(mk).toContain('COMPILE_ARGS += -fsynopsys -Wno-hide');
    expect(mk).toContain('SIM_ARGS += --stop-time=1us');
    expect(mk).toContain('export MY_FLAG=on');
    expect(mk).toContain('export LM_LICENSE_FILE=/opt/licenses/x.dat');
  });
});
