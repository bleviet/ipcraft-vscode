import * as path from 'path';
import { CocotbFramework } from '../../../../generator/testbench/frameworks/CocotbFramework';
import { GhdlEngine } from '../../../../generator/testbench/engines/GhdlEngine';
import { IcarusEngine } from '../../../../generator/testbench/engines/IcarusEngine';
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
    expect(files['tb/Makefile']).toContain('SIM ?= ghdl');
    // GHDL's --std/-frelaxed flags are routed through EXTRA_ARGS (not COMPILE_ARGS) so
    // they also reach the `ghdl -r` run step — see GhdlEngine.cocotbRunArgsVar.
    expect(files['tb/Makefile']).toContain('EXTRA_ARGS += --std=08 -frelaxed');
    expect(files['tb/Makefile']).not.toContain('COMPILE_ARGS += --std=08 -frelaxed');
  });

  it('generates correct Makefile for Questa / ModelSim', () => {
    const files = framework.generate(makeCtx(), new QuestaEngine());
    const mk = files['tb/Makefile'];
    expect(mk).toContain('SIM ?= questa');
    // Questa uses VCOM_ARGS, not COMPILE_ARGS, for vcom flags
    expect(mk).toContain('VCOM_ARGS += -2008');
    expect(mk).not.toContain('COMPILE_ARGS += -2008');
    // Wave output: vsim -wlf flag split into two SIM_ARGS lines
    expect(mk).toContain('SIM_ARGS += -wlf');
    expect(mk).toContain('SIM_ARGS += test_core.wlf');
    // clean_all uses .wlf extension
    expect(mk).toContain('*.wlf');
    // view_waves uses vsim -view
    expect(mk).toContain('vsim -view');
    // COCOTB_TEST_MODULES must be exported so vsim picks it up at startup
    expect(mk).toContain('export COCOTB_TEST_MODULES = $(MODULE)');
  });

  it('exports COCOTB_TEST_MODULES in VHDL Makefile (all engines)', () => {
    const mk = framework.generate(makeCtx(), new GhdlEngine())['tb/Makefile'];
    expect(mk).toContain('export COCOTB_TEST_MODULES = $(MODULE)');
  });

  it('exports COCOTB_TEST_MODULES in SV Makefile', () => {
    const ctx = makeCtx({
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
    });
    const mk = framework.generate(ctx, new IcarusEngine())['tb/Makefile'];
    expect(mk).toContain('export COCOTB_TEST_MODULES = $(MODULE)');
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

describe('CocotbFramework — rtlSourceFiles-driven sources', () => {
  const framework = new CocotbFramework();

  // The caller (IpCoreScaffolder) is responsible for resolving and compile-ordering this
  // list (generated files + fileSets extras, sim paths excluded) before it reaches the
  // framework — see IpCoreScaffolder's collectRtlAbsPaths and its own regression tests.
  const VHDL_RTL_SOURCES = ['rtl/test_core_pkg.vhd', 'rtl/test_core.vhd'];

  const SV_FILESETS = [
    {
      name: 'RTL_Sources',
      files: [{ path: 'include/test_core_defs.svh', type: 'systemverilog', isIncludeFile: true }],
    },
  ];

  it('Makefile lists rtlSourceFiles via BASE_DIR', () => {
    const files = framework.generate(
      makeCtx({ rtlSourceFiles: VHDL_RTL_SOURCES }),
      new GhdlEngine()
    );
    const mk = files['tb/Makefile'];
    expect(mk).toContain('BASE_DIR = $(CURDIR)/..');
    expect(mk).toContain('VHDL_SOURCES += $(BASE_DIR)/rtl/test_core_pkg.vhd');
    expect(mk).toContain('VHDL_SOURCES += $(BASE_DIR)/rtl/test_core.vhd');
    expect(mk).not.toContain('RTL_DIR');
  });

  it('SV Makefile lists rtlSourceFiles and adds include dir from fileSets', () => {
    const ctx = makeCtx({
      isSv: true,
      fileSets: SV_FILESETS,
      rtlSourceFiles: ['rtl/test_core.sv'],
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

  it('conftest.py lists rtlSourceFiles as RTL_SOURCES via BASE_DIR', () => {
    const files = framework.generate(
      makeCtx({ rtlSourceFiles: VHDL_RTL_SOURCES }),
      new GhdlEngine()
    );
    const conf = files['tb/conftest.py'];
    expect(conf).toContain('BASE_DIR = TB_DIR.parent');
    expect(conf).toContain('BASE_DIR / "rtl/test_core_pkg.vhd"');
    expect(conf).toContain('BASE_DIR / "rtl/test_core.vhd"');
    expect(conf).toContain('RTL_SOURCES');
    expect(conf).not.toContain('RTL_DIR');
  });

  it('Makefile emits VHDL sources in the given rtlSourceFiles order', () => {
    // Ordering (pkg before regs before core before bus before top) is the caller's
    // responsibility (compile-order sort happens upstream); the framework must not
    // reorder or drop entries on its way into the template.
    const orderedRtlSourceFiles = [
      'rtl/dut_pkg.vhd',
      'rtl/dut_regs.vhd',
      'rtl/dut_core.vhd',
      'rtl/dut_axil.vhd',
      'rtl/dut.vhd',
    ];
    const mk = framework.generate(
      makeCtx({ rtlSourceFiles: orderedRtlSourceFiles }),
      new GhdlEngine()
    )['tb/Makefile'];
    const lines = mk.split('\n').filter((l) => l.includes('VHDL_SOURCES +='));
    expect(lines[0]).toContain('dut_pkg.vhd');
    expect(lines[1]).toContain('dut_regs.vhd');
    expect(lines[2]).toContain('dut_core.vhd');
    expect(lines[3]).toContain('dut_axil.vhd');
    expect(lines[4]).toContain('dut.vhd');
  });

  it('avmm cocotb test drives the raw byte address, matching the register file decode (regression)', () => {
    // register_file.vhdl.j2 decodes wr_addr/rd_addr as raw byte offsets
    // (matching .mm.yml `offset:` values directly, e.g. a register at
    // offset 8 is compared against `v_addr_index = 8`); bus_avmm.vhdl.j2's
    // wrapper does a plain bit-slice of the address port with no
    // word-to-byte shift. cocotb_test.py.j2 previously wrote
    // `dut.<prefix>_address.value = addr >> 2`, assuming a word-indexed
    // Avalon-MM convention that does not match the generated RTL -- every
    // register access in the generated test silently landed at the wrong
    // offset. This was invisible because the generated test only logs
    // read-back values, never asserts on them.
    const ctx = makeCtx({
      hasMmSlave: true,
      templateContext: {
        entity_name: 'test_core',
        clock_port: 'clk',
        reset_port: 'rst_n',
        reset_active_high: false,
        bus_type: 'avmm',
        bus_prefix: 'avs',
        has_memory_mapped_slave: true,
        memmap_relpath: '../test_core.mmap.yml',
        ports: [],
        parameters: [],
      },
    });
    const testPy = framework.generate(ctx, new GhdlEngine())['tb/test_core_test.py'];
    expect(testPy).toContain('dut.avs_address.value = addr');
    expect(testPy).not.toContain('addr >> 2');
  });

  it('avmm cocotb _read_reg waits an extra cycle for a fixed-latency slave (regression)', () => {
    // register_file.vhdl.j2's read path is registered (readdata is driven
    // from a signal set inside a clocked process), so for a slave with no
    // readdatavalid handshake, readdata is only valid one cycle after
    // `read` is sampled -- not in the same cycle `_read_reg` deasserts
    // `read`. Confirmed by running the generated testbench end-to-end
    // against a real GHDL simulation: every register read returned the
    // *previous* bus access's result until this extra RisingEdge was added.
    const ctx = makeCtx({
      hasMmSlave: true,
      templateContext: {
        entity_name: 'test_core',
        clock_port: 'clk',
        reset_port: 'rst_n',
        reset_active_high: false,
        bus_type: 'avmm',
        bus_prefix: 'avs',
        has_memory_mapped_slave: true,
        memmap_relpath: '../test_core.mmap.yml',
        ports: [],
        parameters: [],
      },
    });
    const testPy = framework.generate(ctx, new GhdlEngine())['tb/test_core_test.py'];
    const readFn = testPy.slice(testPy.indexOf('async def _read_reg'));
    const deassertIdx = readFn.indexOf('avs_read.value = 0');
    // Old (buggy) code returned readdata right after this point whenever no
    // readdatavalid port exists -- no unconditional extra edge afterward.
    const elseIdx = readFn.indexOf('\n    else:\n', deassertIdx);
    expect(elseIdx).toBeGreaterThan(deassertIdx);
    const returnIdx = readFn.indexOf('return int(');
    const settleEdgeIdx = readFn.indexOf('await RisingEdge', elseIdx);
    expect(settleEdgeIdx).toBeGreaterThan(elseIdx);
    expect(settleEdgeIdx).toBeLessThan(returnIdx);
  });

  it('falls back to entity-name VHDL logic when rtlSourceFiles is empty', () => {
    const mk = framework.generate(makeCtx({ rtlSourceFiles: [] }), new GhdlEngine())['tb/Makefile'];
    expect(mk).toContain('VHDL_SOURCES += $(BASE_DIR)/rtl/test_core.vhd');
  });

  it('conftest.py falls back to entity-name SV logic for SV project with no rtlSourceFiles', () => {
    const ctx = makeCtx({
      isSv: true,
      rtlSourceFiles: [],
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
