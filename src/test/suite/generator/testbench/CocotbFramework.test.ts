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

describe('CocotbFramework — fileset-driven sources', () => {
  const framework = new CocotbFramework();

  const VHDL_FILESETS = [
    {
      name: 'RTL_Sources',
      files: [
        { path: 'rtl/test_core_pkg.vhd', type: 'vhdl' },
        { path: 'rtl/test_core.vhd', type: 'vhdl' },
      ],
    },
    {
      name: 'Simulation_Resources',
      files: [
        { path: 'tb/test_core_tb.vhd', type: 'vhdl' },
        { path: 'tb/Makefile', type: 'unknown' },
      ],
    },
  ];

  const SV_FILESETS = [
    {
      name: 'RTL_Sources',
      files: [
        { path: 'include/test_core_defs.svh', type: 'systemverilog', isIncludeFile: true },
        { path: 'rtl/test_core.sv', type: 'systemverilog' },
      ],
    },
  ];

  it('Makefile lists fileset VHDL sources via BASE_DIR', () => {
    const files = framework.generate(makeCtx({ fileSets: VHDL_FILESETS }), new GhdlEngine());
    const mk = files['tb/Makefile'];
    expect(mk).toContain('BASE_DIR = $(CURDIR)/..');
    expect(mk).toContain('VHDL_SOURCES += $(BASE_DIR)/rtl/test_core_pkg.vhd');
    expect(mk).toContain('VHDL_SOURCES += $(BASE_DIR)/rtl/test_core.vhd');
    expect(mk).not.toContain('RTL_DIR');
  });

  it('Makefile does not add tb/ files from fileSets as VHDL sources', () => {
    const files = framework.generate(makeCtx({ fileSets: VHDL_FILESETS }), new GhdlEngine());
    expect(files['tb/Makefile']).not.toContain('test_core_tb.vhd');
  });

  it('SV Makefile lists fileset SV sources and adds include dir', () => {
    const ctx = makeCtx({
      isSv: true,
      fileSets: SV_FILESETS,
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
    });
    const mk = framework.generate(ctx, new IcarusEngine())['tb/Makefile'];
    expect(mk).toContain('VERILOG_SOURCES += $(BASE_DIR)/rtl/test_core.sv');
    expect(mk).toContain('COMPILE_ARGS += -I$(BASE_DIR)/include');
    expect(mk).not.toContain('RTL_DIR');
  });

  it('conftest.py lists fileset sources as RTL_SOURCES via BASE_DIR', () => {
    const files = framework.generate(makeCtx({ fileSets: VHDL_FILESETS }), new GhdlEngine());
    const conf = files['tb/conftest.py'];
    expect(conf).toContain('BASE_DIR = TB_DIR.parent');
    expect(conf).toContain('BASE_DIR / "rtl/test_core_pkg.vhd"');
    expect(conf).toContain('BASE_DIR / "rtl/test_core.vhd"');
    expect(conf).toContain('RTL_SOURCES');
    expect(conf).not.toContain('RTL_DIR');
  });

  it('conftest.py does not add tb/ simulation files as RTL_SOURCES', () => {
    const conf = framework.generate(makeCtx({ fileSets: VHDL_FILESETS }), new GhdlEngine())[
      'tb/conftest.py'
    ];
    expect(conf).not.toContain('BASE_DIR / "tb/');
  });

  it('Makefile emits VHDL sources in compile order (pkg before regs before core before bus before top)', () => {
    // Intentionally provide files in wrong order to verify the sort is applied
    const wrongOrderFilesets = [
      {
        name: 'RTL_Sources',
        files: [
          { path: 'rtl/dut.vhd', type: 'vhdl' }, // top — rank 4
          { path: 'rtl/dut_axil.vhd', type: 'vhdl' }, // bus wrapper — rank 3
          { path: 'rtl/dut_core.vhd', type: 'vhdl' }, // core — rank 2
          { path: 'rtl/dut_regs.vhd', type: 'vhdl' }, // reg file — rank 1
          { path: 'rtl/dut_pkg.vhd', type: 'vhdl' }, // package — rank 0
        ],
      },
    ];
    const mk = framework.generate(makeCtx({ fileSets: wrongOrderFilesets }), new GhdlEngine())[
      'tb/Makefile'
    ];
    const lines = mk.split('\n').filter((l) => l.includes('VHDL_SOURCES +='));
    expect(lines[0]).toContain('dut_pkg.vhd');
    expect(lines[1]).toContain('dut_regs.vhd');
    expect(lines[2]).toContain('dut_core.vhd');
    expect(lines[3]).toContain('dut_axil.vhd');
    expect(lines[4]).toContain('dut.vhd');
  });

  it('falls back to entity-name VHDL logic when fileSets is empty', () => {
    const mk = framework.generate(makeCtx({ fileSets: [] }), new GhdlEngine())['tb/Makefile'];
    expect(mk).toContain('VHDL_SOURCES += $(BASE_DIR)/rtl/test_core.vhd');
  });

  it('conftest.py falls back to entity-name SV logic for SV project with no fileSets', () => {
    const ctx = makeCtx({
      isSv: true,
      fileSets: [],
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
    });
    const conf = framework.generate(ctx, new IcarusEngine())['tb/conftest.py'];
    expect(conf).toContain('BASE_DIR / "rtl/test_core.sv"');
    expect(conf).not.toContain('BASE_DIR / "rtl/test_core.vhd"');
  });
});
