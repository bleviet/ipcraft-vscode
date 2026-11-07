import * as fs from 'fs';
import * as path from 'path';
import type { SystemGraph, SystemNet, SystemPin } from '../../../../domain/systemGraph';
import { readBdTcl } from '../../../../parser/system/BdTclReader';

const FIXTURE = path.join(__dirname, '../../../fixtures/system-design/zynq_dma_system.tcl');
const fixtureText = fs.readFileSync(FIXTURE, 'utf8');
const fixtureLines = fixtureText.split('\n');

function lineOf(pattern: string): number {
  const idx = fixtureLines.findIndex((l) => l.includes(pattern));
  if (idx < 0) {
    throw new Error(`pattern not in fixture: ${pattern}`);
  }
  return idx + 1;
}

function pin(graph: SystemGraph, instance: string, name: string): SystemPin {
  const found = graph.instances[instance].pins.find((p) => p.name === name);
  if (!found) {
    throw new Error(`no pin ${instance}/${name}`);
  }
  return found;
}

function net(graph: SystemGraph, level: string, name: string): SystemNet {
  const found = graph.nets.find((n) => n.id === `${level}::${name}`);
  if (!found) {
    throw new Error(`no net ${level}::${name}`);
  }
  return found;
}

describe('readBdTcl: zynq_dma_system fixture', () => {
  const graph = readBdTcl(fixtureText, FIXTURE);

  it('reads metadata', () => {
    expect(graph.name).toBe('zynq_dma_system');
    expect(graph.source.toolVersion).toBe('2024.2');
    expect(graph.source.format).toBe('vivado-bd-tcl');
    expect(graph.levels['/'].name).toBe('zynq_dma_system');
  });

  it('reads levels and instances in creation order', () => {
    expect(Object.keys(graph.levels).sort()).toEqual([
      '/',
      '/dsp_pipeline',
      '/dsp_pipeline/coeff_bank',
    ]);
    const names = (level: string) =>
      graph.levels[level].instances.map((p) => graph.instances[p].name);
    expect(names('/')).toEqual([
      'processing_system7_0',
      'rst_ps7_0_100M',
      'ps7_0_axi_periph',
      'axi_dma_0',
      'axi_gpio_0',
      'axi_mem_intercon',
      'xlconcat_0',
      'dsp_pipeline',
      'pulse_gen_0',
    ]);
    expect(names('/dsp_pipeline')).toEqual(['axis_data_fifo_0', 'fir_compiler_0', 'coeff_bank']);
    expect(names('/dsp_pipeline/coeff_bank')).toEqual(['config_fifo', 'tie_valid']);
    expect(graph.instances['/dsp_pipeline'].kind).toBe('hier');
    expect(graph.instances['/pulse_gen_0']).toMatchObject({
      kind: 'module',
      moduleRef: 'pulse_gen',
    });
    expect(graph.instances['/axi_dma_0']).toMatchObject({
      kind: 'ip',
      vlnv: 'xilinx.com:ip:axi_dma:7.1',
      parent: '/',
    });
  });

  it('reads boundary pins', () => {
    const names = graph.levels['/'].boundaryPins.map((p) => p.name);
    expect(names).toEqual([
      'DDR',
      'FIXED_IO',
      'leds_4bits',
      'ext_trigger',
      'trigger_pulse',
      'pl_irq',
    ]);
    const boundary = (n: string) => graph.levels['/'].boundaryPins.find((p) => p.name === n)!;
    expect(boundary('leds_4bits')).toMatchObject({
      isInterface: true,
      direction: 'master',
      directionSource: 'declared',
    });
    expect(boundary('ext_trigger')).toMatchObject({ direction: 'in', isInterface: false });
    expect(boundary('trigger_pulse').direction).toBe('out');
    expect(boundary('pl_irq')).toMatchObject({
      direction: 'in',
      signalType: 'intr',
      parameters: { 'CONFIG.SENSITIVITY': 'LEVEL_HIGH' },
    });
    expect(boundary('pl_irq').line).toBe(lineOf('set pl_irq [ create_bd_port'));
  });

  it('reads parameters', () => {
    expect(Object.keys(graph.instances['/axi_dma_0'].parameters)).toEqual([
      'CONFIG.c_include_sg',
      'CONFIG.c_m_axi_mm2s_data_width',
      'CONFIG.c_s2mm_burst_size',
      'CONFIG.c_sg_include_stscntrl_strm',
    ]);
    expect(graph.instances['/xlconcat_0'].parameters['CONFIG.NUM_PORTS']).toBe('3');
    expect(graph.instances['/pulse_gen_0'].parameters['CONFIG.PULSE_CYCLES']).toBe('8');
    expect(
      graph.instances['/dsp_pipeline/fir_compiler_0'].parameters['CONFIG.CoefficientVector']
    ).toBe('12,-34,87,210,87,-34,12');
  });

  it('reads nets', () => {
    const at = (level: string) => graph.nets.filter((n) => n.level === level);
    expect(at('/')).toHaveLength(20);
    expect(at('/').filter((n) => n.isInterface)).toHaveLength(11);
    expect(at('/').filter((n) => !n.isInterface)).toHaveLength(9);
    expect(at('/dsp_pipeline')).toHaveLength(6);
    expect(at('/dsp_pipeline/coeff_bank')).toHaveLength(3);
    expect(net(graph, '/', 'processing_system7_0_FCLK_CLK0').endpoints).toHaveLength(12);
  });

  it('points hierarchy and net lines at the right source lines', () => {
    expect(graph.instances['/dsp_pipeline'].line).toBe(
      lineOf('create_hier_cell_dsp_pipeline [current_bd_instance .] dsp_pipeline')
    );
    expect(graph.instances['/dsp_pipeline'].procLine).toBe(
      lineOf('proc create_hier_cell_dsp_pipeline')
    );
    expect(graph.instances['/dsp_pipeline/coeff_bank'].line).toBe(
      lineOf('create_hier_cell_coeff_bank $hier_obj coeff_bank')
    );
    expect(graph.instances['/dsp_pipeline/coeff_bank'].procLine).toBe(
      lineOf('proc create_hier_cell_coeff_bank')
    );
    expect(graph.instances['/axi_dma_0'].line).toBe(lineOf('set axi_dma_0 [ create_bd_cell'));
    expect(graph.instances['/pulse_gen_0'].line).toBe(lineOf('if { [catch {set pulse_gen_0'));
    expect(net(graph, '/', 'processing_system7_0_FCLK_CLK0').line).toBe(
      lineOf('connect_bd_net -net processing_system7_0_FCLK_CLK0')
    );
    expect(net(graph, '/', 'axi_dma_0_M_AXIS_MM2S').line).toBe(
      lineOf('connect_bd_intf_net -intf_net axi_dma_0_M_AXIS_MM2S')
    );
  });

  it('reads address segments', () => {
    expect(graph.addressSegments).toHaveLength(4);
    expect(graph.addressSegments[0]).toEqual({
      addressSpace: 'processing_system7_0/Data',
      segment: 'axi_dma_0/S_AXI_LITE/Reg',
      offset: '0x40400000',
      range: '0x00010000',
      masterInstance: '/processing_system7_0',
      slaveInstance: '/axi_dma_0',
      line: lineOf('assign_bd_address -offset 0x40400000'),
    });
  });

  it('infers pin directions', () => {
    expect(pin(graph, '/processing_system7_0', 'DDR')).toMatchObject({
      direction: 'master',
      directionSource: 'connection',
    });
    expect(pin(graph, '/axi_dma_0', 'M_AXIS_MM2S')).toMatchObject({
      direction: 'master',
      directionSource: 'connection',
    });
    expect(pin(graph, '/dsp_pipeline', 'S_AXIS')).toMatchObject({ direction: 'slave' });
    expect(pin(graph, '/processing_system7_0', 'M_AXI_GP0')).toMatchObject({
      direction: 'master',
      directionSource: 'name',
    });
    expect(pin(graph, '/pulse_gen_0', 'trigger')).toMatchObject({
      direction: 'in',
      directionSource: 'connection',
    });
    expect(pin(graph, '/pulse_gen_0', 'pulse')).toMatchObject({
      direction: 'out',
      directionSource: 'connection',
    });
    expect(pin(graph, '/xlconcat_0', 'In2')).toMatchObject({ direction: 'in' });
    expect(pin(graph, '/axi_dma_0', 'mm2s_introut').direction).toBe('unknown');
  });

  it('classifies nets', () => {
    const cat = (level: string, name: string) => {
      const n = net(graph, level, name);
      return [n.category, n.categorySource];
    };
    expect(cat('/', 'processing_system7_0_FCLK_CLK0')).toEqual(['clock', 'declared']);
    expect(cat('/', 'processing_system7_0_FCLK_RESET0_N')).toEqual(['reset', 'name']);
    expect(cat('/', 'rst_ps7_0_100M_peripheral_aresetn')).toEqual(['reset', 'declared']);
    expect(cat('/', 'axi_dma_0_mm2s_introut')).toEqual(['interrupt', 'name']);
    expect(cat('/', 'pl_irq_1')).toEqual(['interrupt', 'declared']);
    expect(cat('/', 'ext_trigger_1')).toEqual(['signal', 'default']);
    expect(cat('/', 'xlconcat_0_dout')).toEqual(['interrupt', 'name']);
    expect(cat('/', 'axi_dma_0_M_AXIS_MM2S')).toEqual(['axis', 'declared']);
    expect(cat('/', 'processing_system7_0_M_AXI_GP0')).toEqual(['aximm', 'name']);
    expect(cat('/', 'processing_system7_0_DDR')).toEqual(['interface', 'default']);
    expect(cat('/dsp_pipeline', 'aclk_1')).toEqual(['clock', 'declared']);
  });

  it('reports diagnostics and capabilities', () => {
    expect(graph.diagnostics.filter((d) => d.severity === 'warning')).toEqual([]);
    expect(graph.diagnostics).toEqual([
      {
        severity: 'info',
        message: 'Skipped Vivado-only commands: validate_bd_design, save_bd_design',
        lines: [lineOf('  validate_bd_design'), lineOf('  save_bd_design')],
      },
      {
        severity: 'info',
        message:
          'Clock, reset, and interrupt nets were partly classified by name because no IP definitions are available.',
      },
    ]);
    expect(graph.capabilities).toEqual({
      hierarchy: 'complete',
      connections: 'complete',
      addressMap: 'complete',
      userParameters: 'complete',
      propagatedParameters: 'unavailable',
      unconnectedPins: 'unavailable',
    });
  });

  it('is JSON-serializable and does not leak rowId-like state', () => {
    expect(() => JSON.stringify(graph)).not.toThrow();
  });
});

describe('readBdTcl: inline scripts', () => {
  const read = (script: string, fileName = '/x/design.tcl') => readBdTcl(script, fileName);

  it('warns on foreach and marks connections partial', () => {
    const g = read(
      ['create_bd_cell -type ip -vlnv a:b:c:1 foo', 'foreach x {a b} {', '  puts $x', '}'].join(
        '\n'
      )
    );
    expect(g.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'warning', lines: [2] })
    );
    expect(g.capabilities.connections).toBe('partial');
    expect(g.capabilities.addressMap).toBe('partial');
  });

  it('warns on apply_bd_automation', () => {
    const g = read('apply_bd_automation -rule xilinx.com:bd_rule:axi4 [get_bd_cells foo]');
    expect(g.diagnostics).toContainEqual({
      severity: 'warning',
      message: 'Cannot be resolved offline: apply_bd_automation',
      lines: [1],
    });
    expect(g.capabilities.connections).toBe('partial');
  });

  it('warns on get_bd_pins -filter', () => {
    const g = read(
      [
        'create_bd_cell -type ip -vlnv a:b:c:1 foo',
        'connect_bd_net [get_bd_pins -filter {TYPE == clk} foo/*] [get_bd_pins foo/clk]',
      ].join('\n')
    );
    expect(g.diagnostics.filter((d) => d.severity === 'warning').length).toBeGreaterThan(0);
    expect(g.capabilities.connections).toBe('partial');
  });

  it('appends to an existing net with connect_bd_net -net [get_bd_nets x]', () => {
    const g = read(
      [
        'create_bd_cell -type ip -vlnv a:b:c:1 foo',
        'create_bd_cell -type ip -vlnv a:b:c:1 bar',
        'connect_bd_net -net x [get_bd_pins foo/a] [get_bd_pins bar/a]',
        'connect_bd_net -net [get_bd_nets x] [get_bd_pins foo/b] [get_bd_pins bar/a]',
      ].join('\n')
    );
    expect(g.nets).toHaveLength(1);
    expect(g.nets[0].endpoints.map((e) => `${e.instance}:${e.pin}`)).toEqual([
      '/foo:a',
      '/bar:a',
      '/foo:b',
    ]);
    expect(g.nets[0].line).toBe(3);
  });

  it('generates a net name when -net is missing', () => {
    const g = read(
      [
        'create_bd_cell -type ip -vlnv a:b:c:1 foo',
        'create_bd_port -dir I ext',
        'connect_bd_net [get_bd_pins foo/clk] [get_bd_ports ext]',
        'connect_bd_net [get_bd_ports ext] [get_bd_pins foo/rst]',
      ].join('\n')
    );
    expect(g.nets.map((n) => n.name)).toEqual(['foo_clk', 'ext']);
  });

  it('stores set_property on a cell by getter and by variable', () => {
    const g = read(
      [
        'set foo [create_bd_cell -type ip -vlnv a:b:c:1 foo]',
        'set_property CONFIG.X {1} [get_bd_cells foo]',
        'set_property CONFIG.Y 2 $foo',
        'set_property -dict [list CONFIG.A {x y} CONFIG.B "q"] $foo',
        'set_property BOARD_PART abc [current_project]',
      ].join('\n')
    );
    expect(g.instances['/foo'].parameters).toEqual({
      'CONFIG.X': '1',
      'CONFIG.Y': '2',
      'CONFIG.A': 'x y',
      'CONFIG.B': 'q',
    });
    expect(g.diagnostics.filter((d) => d.severity === 'warning')).toEqual([]);
  });

  it('resolves absolute pin paths', () => {
    const g = read(
      [
        'create_bd_cell -type ip -vlnv a:b:c:1 foo',
        'create_bd_cell -type ip -vlnv a:b:c:1 bar',
        'connect_bd_net -net n [get_bd_pins /foo/bar] [get_bd_pins /bar/baz]',
      ].join('\n')
    );
    expect(g.nets[0].endpoints).toEqual([
      { instance: '/foo', pin: 'bar' },
      { instance: '/bar', pin: 'baz' },
    ]);
  });

  it('reads an address segment without offset', () => {
    const g = read('assign_bd_address [get_bd_addr_segs foo/S_AXI/Reg]');
    expect(g.addressSegments).toEqual([
      {
        addressSpace: '',
        segment: 'foo/S_AXI/Reg',
        masterInstance: '',
        slaveInstance: '/foo',
        line: 1,
      },
    ]);
  });

  it('reads the older create_bd_addr_seg form', () => {
    const g = read(
      'create_bd_addr_seg -range 0x1000 -offset 0x4000 [get_bd_addr_spaces cpu/Data] [get_bd_addr_segs foo/S_AXI/Reg] SEG_foo'
    );
    expect(g.addressSegments[0]).toMatchObject({
      addressSpace: 'cpu/Data',
      masterInstance: '/cpu',
      slaveInstance: '/foo',
      offset: '0x4000',
      range: '0x1000',
    });
  });

  it('reports exclude_bd_addr_seg as info without a segment', () => {
    const g = read('exclude_bd_addr_seg [get_bd_addr_segs foo/S_AXI/Reg]');
    expect(g.addressSegments).toEqual([]);
    expect(g.diagnostics[0]).toMatchObject({ severity: 'info', lines: [1] });
  });

  it('reads a hand-written script without procs', () => {
    const g = read(
      [
        'create_bd_design my_sys',
        'create_bd_cell -type hier sub',
        'current_bd_instance /sub',
        'create_bd_intf_pin -mode Slave -vlnv xilinx.com:interface:axis_rtl:1.0 S',
        'create_bd_cell -type ip -vlnv a:b:c:1 inner',
        'connect_bd_intf_net [get_bd_intf_pins S] [get_bd_intf_pins inner/S_AXIS]',
        'current_bd_instance /',
      ].join('\n'),
      '/p/other.tcl'
    );
    expect(g.name).toBe('my_sys');
    expect(g.instances['/sub'].line).toBe(2);
    expect(g.instances['/sub'].procLine).toBeUndefined();
    expect(g.instances['/sub/inner'].parent).toBe('/sub');
    expect(g.nets[0]).toMatchObject({
      id: '/sub::S',
      level: '/sub',
    });
    expect(pin(g, '/sub/inner', 'S_AXIS')).toMatchObject({ direction: 'slave' });
  });

  it('falls back to the file base name for the design name', () => {
    expect(read('create_bd_cell -type hier a', '/p/my_design.tcl').name).toBe('my_design');
  });

  it('adds one info per unrecognized command', () => {
    const g = read(['frobnicate 1', 'frobnicate 2', 'puts hi'].join('\n'));
    expect(g.diagnostics.filter((d) => d.severity === 'info')).toEqual([
      { severity: 'info', message: 'Ignored unrecognized command `frobnicate`', lines: [1, 2] },
    ]);
  });

  it('reports a skipped if block that creates design objects', () => {
    const g = read(['if { $x } {', '  create_bd_cell -type ip -vlnv a:b:c:1 foo', '}'].join('\n'));
    expect(g.instances['/foo']).toBeUndefined();
    expect(g.diagnostics).toContainEqual({
      severity: 'info',
      message: 'Skipped a conditional block that creates design objects',
      lines: [1],
    });
  });

  it('guards against recursive procs', () => {
    const g = read(['proc loop {} {', '  loop', '}', 'loop'].join('\n'));
    expect(g.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
  });

  it('warns on an unknown cell type', () => {
    const g = read('create_bd_cell -type weird foo');
    expect(g.diagnostics[0]).toMatchObject({ severity: 'warning' });
    expect(g.instances['/foo']).toBeUndefined();
  });

  it('joins continuation lines with leading whitespace', () => {
    const g = read(['create_bd_cell -type ip \\', '    -vlnv a:b:c:1 \\', '   foo'].join('\n'));
    expect(g.instances['/foo']).toMatchObject({ vlnv: 'a:b:c:1', line: 1 });
  });
});

describe('readBdTcl: review regressions', () => {
  const read = (script: string) => readBdTcl(script, '/x/design.tcl');
  const SKIPPED = 'Skipped a conditional block that creates design objects';

  it('does not evaluate a one-line if body that sets a created cell', () => {
    const g = read('if { $use } { set dma [create_bd_cell -type ip -vlnv a:b:c:1 dma] }');
    expect(g.instances['/dma']).toBeUndefined();
    expect(g.diagnostics).toContainEqual({ severity: 'info', message: SKIPPED, lines: [1] });
  });

  it('reports a one-line if body that creates a cell', () => {
    const g = read('if { $use } { create_bd_cell -type ip -vlnv a:b:c:1 x }');
    expect(g.instances['/x']).toBeUndefined();
    expect(g.diagnostics).toContainEqual({ severity: 'info', message: SKIPPED, lines: [1] });
  });

  it('reports structural commands in else bodies closed on the last line', () => {
    const g = read(
      ['if { $a } {', '  puts hi', '} else { create_bd_cell -type ip -vlnv a:b:c:1 y }'].join('\n')
    );
    expect(g.instances['/y']).toBeUndefined();
    expect(g.diagnostics).toContainEqual({ severity: 'info', message: SKIPPED, lines: [1] });
  });

  it('still evaluates the cell created in the if condition', () => {
    const g = read(
      [
        'set n m',
        'if { [catch {set c [create_bd_cell -type module -reference $n c0] } e] } {',
        '  return 1',
        '}',
        'set_property CONFIG.K {1} $c',
      ].join('\n')
    );
    expect(g.instances['/c0']).toMatchObject({ kind: 'module', moduleRef: 'm', line: 2 });
    expect(g.instances['/c0'].parameters['CONFIG.K']).toBe('1');
    expect(g.diagnostics.some((d) => d.message === SKIPPED)).toBe(false);
  });

  it('substitutes variables in -dict values', () => {
    const g = read(
      [
        'set n 4',
        'set c [create_bd_cell -type ip -vlnv a:b:c:1 c]',
        'set_property -dict [list CONFIG.N $n CONFIG.L {$n}] $c',
      ].join('\n')
    );
    expect(g.instances['/c'].parameters).toEqual({ 'CONFIG.N': '4', 'CONFIG.L': '$n' });
  });

  it('keeps quoted -dict values with spaces and later pairs aligned', () => {
    const g = read(
      [
        'set c [create_bd_cell -type ip -vlnv a:b:c:1 c]',
        'set_property -dict [list CONFIG.S "a b" CONFIG.T {1}] $c',
      ].join('\n')
    );
    expect(g.instances['/c'].parameters).toEqual({ 'CONFIG.S': 'a b', 'CONFIG.T': '1' });
  });

  it('substitutes variables in the single-pair set_property form', () => {
    const g = read(
      [
        'set n 4',
        'set c [create_bd_cell -type ip -vlnv a:b:c:1 c]',
        'set_property CONFIG.N $n $c',
      ].join('\n')
    );
    expect(g.instances['/c'].parameters['CONFIG.N']).toBe('4');
  });

  it('keeps a nested bracketed -dict item as one literal value', () => {
    const g = read(
      [
        'set c [create_bd_cell -type ip -vlnv a:b:c:1 c]',
        'set_property -dict [list CONFIG.F [get_property CONFIG.F [get_bd_pins c/clk]] CONFIG.N {2}] $c',
      ].join('\n')
    );
    expect(g.instances['/c'].parameters).toEqual({
      'CONFIG.F': '[get_property CONFIG.F [get_bd_pins c/clk]]',
      'CONFIG.N': '2',
    });
  });

  it('keeps pairs aligned after a bracketed item and does not substitute inside it', () => {
    const g = read(
      [
        'set n 4',
        'set c [create_bd_cell -type ip -vlnv a:b:c:1 c]',
        'set_property -dict [list CONFIG.A [expr $n] CONFIG.B $n CONFIG.C "x y"] $c',
      ].join('\n')
    );
    expect(g.instances['/c'].parameters).toEqual({
      'CONFIG.A': '[expr $n]',
      'CONFIG.B': '4',
      'CONFIG.C': 'x y',
    });
  });
});

describe('readBdTcl: -freq_hz', () => {
  const read = (script: string) => readBdTcl(script, '/x/design.tcl');
  const boundary = (g: SystemGraph, name: string, level = '/') =>
    g.levels[level].boundaryPins.find((p) => p.name === name)!;

  it('stores the flag of a port as CONFIG.FREQ_HZ and keeps the port name', () => {
    const g = read(
      [
        'set clk [ create_bd_port -dir I -type clk -freq_hz 100000000 s_axi_aclk ]',
        'set bare [ create_bd_port -dir I -type clk m_axis_clk ]',
      ].join('\n')
    );
    expect(g.levels['/'].boundaryPins.map((p) => p.name)).toEqual(['s_axi_aclk', 'm_axis_clk']);
    expect(boundary(g, 's_axi_aclk')).toMatchObject({
      direction: 'in',
      signalType: 'clk',
      parameters: { 'CONFIG.FREQ_HZ': '100000000' },
    });
    expect(boundary(g, 'm_axis_clk').parameters).toEqual({});
  });

  it('never takes the value for the name, wherever the flag stands', () => {
    const g = read(
      [
        'create_bd_port -dir I -freq_hz 250000000 -type clk a_clk',
        'create_bd_port -freq_hz 50000000 -dir I -type clk b_clk',
      ].join('\n')
    );
    expect(g.levels['/'].boundaryPins.map((p) => [p.name, p.parameters['CONFIG.FREQ_HZ']])).toEqual(
      [
        ['a_clk', '250000000'],
        ['b_clk', '50000000'],
      ]
    );
  });

  it('stores the flag of a hierarchy pin', () => {
    const g = read(
      [
        'set h [create_bd_cell -type hier h]',
        'current_bd_instance $h',
        'create_bd_pin -dir I -type clk -freq_hz 125000000 aclk',
      ].join('\n')
    );
    expect(boundary(g, 'aclk', '/h').parameters).toEqual({ 'CONFIG.FREQ_HZ': '125000000' });
    expect(g.instances['/h'].pins.find((p) => p.name === 'aclk')?.parameters).toEqual({
      'CONFIG.FREQ_HZ': '125000000',
    });
  });

  it('lets a later set_property override the flag', () => {
    const g = read(
      [
        'set clk [ create_bd_port -dir I -type clk -freq_hz 100000000 s_axi_aclk ]',
        'set_property -dict [ list CONFIG.FREQ_HZ {200000000} ] $clk',
      ].join('\n')
    );
    expect(boundary(g, 's_axi_aclk').parameters['CONFIG.FREQ_HZ']).toBe('200000000');
  });

  it('keeps a set_property that precedes the flag of a later declaration of the same port', () => {
    const g = read(
      [
        'set clk [ create_bd_port -dir I -type clk s_axi_aclk ]',
        'set_property CONFIG.FREQ_HZ 200000000 $clk',
        'create_bd_port -dir I -type clk -freq_hz 100000000 s_axi_aclk',
      ].join('\n')
    );
    expect(boundary(g, 's_axi_aclk').parameters['CONFIG.FREQ_HZ']).toBe('200000000');
  });
});

describe('readBdTcl: known IP output pins', () => {
  const read = (script: string) => readBdTcl(script, '/x/design.tcl');
  const SCRIPT = [
    'set clk_wizard_0 [ create_bd_cell -type ip -vlnv xilinx.com:ip:clk_wizard:1.0 clk_wizard_0 ]',
    'set rst_0 [ create_bd_cell -type ip -vlnv xilinx.com:ip:proc_sys_reset:5.0 rst_0 ]',
    'set one_0 [ create_bd_cell -type ip -vlnv xilinx.com:ip:xlconstant:1.1 one_0 ]',
    'set blk_0 [ create_bd_cell -type ip -vlnv acme.com:ip:blk:1.0 blk_0 ]',
    'connect_bd_net -net clk1 [get_bd_pins blk_0/clk_a] [get_bd_pins clk_wizard_0/clk_out1_o1] [get_bd_pins rst_0/slowest_sync_clk]',
    'connect_bd_net -net clk2 [get_bd_pins blk_0/clk_b] [get_bd_pins clk_wizard_0/clk_out2]',
    'connect_bd_net -net locked [get_bd_pins clk_wizard_0/locked] [get_bd_pins rst_0/dcm_locked]',
    'connect_bd_net -net rstn [get_bd_pins blk_0/aresetn] [get_bd_pins rst_0/peripheral_aresetn]',
    'connect_bd_net -net one [get_bd_pins clk_wizard_0/clk_out1_ce] [get_bd_pins clk_wizard_0/clk_out1_clr_n] [get_bd_pins one_0/dout]',
    'connect_bd_net -net spare [get_bd_pins blk_0/spare_a] [get_bd_pins blk_0/spare_b]',
  ].join('\n');
  const graph = read(SCRIPT);

  it('gives the outputs of the clocking wizard, the reset block and the constant the rule direction', () => {
    for (const [instance, name] of [
      ['/clk_wizard_0', 'clk_out1_o1'],
      ['/clk_wizard_0', 'clk_out2'],
      ['/clk_wizard_0', 'locked'],
      ['/rst_0', 'peripheral_aresetn'],
      ['/one_0', 'dout'],
    ]) {
      expect(pin(graph, instance, name)).toMatchObject({
        direction: 'out',
        directionSource: 'rule',
      });
    }
  });

  it('turns the other ends of those nets into inputs by connection', () => {
    for (const [instance, name] of [
      ['/blk_0', 'clk_a'],
      ['/blk_0', 'clk_b'],
      ['/blk_0', 'aresetn'],
      ['/rst_0', 'slowest_sync_clk'],
      ['/rst_0', 'dcm_locked'],
      ['/clk_wizard_0', 'clk_out1_ce'],
      ['/clk_wizard_0', 'clk_out1_clr_n'],
    ]) {
      expect(pin(graph, instance, name)).toMatchObject({
        direction: 'in',
        directionSource: 'connection',
      });
    }
  });

  it('leaves the pins of an unknown IP unknown when nothing on the net is a source', () => {
    expect(pin(graph, '/blk_0', 'spare_a')).toMatchObject({
      direction: 'unknown',
      directionSource: 'unknown',
    });
    expect(pin(graph, '/blk_0', 'spare_b').direction).toBe('unknown');
  });

  it('does not give an output to a pin of an IP that the table does not know', () => {
    const unknown = read(SCRIPT.replace('xilinx.com:ip:clk_wizard:', 'acme.com:ip:other_wizard:'));
    expect(pin(unknown, '/clk_wizard_0', 'clk_out2').directionSource).not.toBe('rule');
    expect(pin(unknown, '/clk_wizard_0', 'clk_out2').direction).toBe('unknown');
    expect(pin(unknown, '/rst_0', 'peripheral_aresetn')).toMatchObject({
      direction: 'out',
      directionSource: 'rule',
    });
  });

  it('does not give an output to a module reference named like a known IP', () => {
    const module = read(
      [
        'set clk_wiz_0 [ create_bd_cell -type module -reference clk_wiz clk_wiz_0 ]',
        'set blk_0 [ create_bd_cell -type ip -vlnv acme.com:ip:blk:1.0 blk_0 ]',
        'connect_bd_net -net clk1 [get_bd_pins blk_0/clk_a] [get_bd_pins clk_wiz_0/clk_out1]',
      ].join('\n')
    );
    expect(module.instances['/clk_wiz_0']).toMatchObject({ kind: 'module', moduleRef: 'clk_wiz' });
    expect(pin(module, '/clk_wiz_0', 'clk_out1').direction).toBe('unknown');
    expect(pin(module, '/blk_0', 'clk_a').direction).toBe('unknown');
  });

  it('reads the pins of versal_clocks.tcl the same way', () => {
    const versal = read(
      fs.readFileSync(
        path.join(__dirname, '../../../fixtures/system-design/versal_clocks.tcl'),
        'utf8'
      )
    );
    for (const [instance, name] of [
      ['/ps_cips', 'pl0_ref_clk'],
      ['/ps_cips', 'pl0_resetn'],
      ['/clk_wizard_0', 'clk_out1'],
      ['/clk_wizard_0', 'clk_out2'],
      ['/clk_wizard_0', 'locked'],
      ['/rst_clk_out1', 'peripheral_aresetn'],
      ['/rst_clk_out2', 'peripheral_aresetn'],
    ]) {
      expect(pin(versal, instance, name)).toMatchObject({
        direction: 'out',
        directionSource: 'rule',
      });
    }
    expect(pin(versal, '/clk_wizard_0', 'clk_in1')).toMatchObject({
      direction: 'in',
      directionSource: 'connection',
    });
    expect(pin(versal, '/stream_src', 'M_AXIS')).toMatchObject({ directionSource: 'name' });
  });
});
