import * as fs from 'fs';
import * as path from 'path';
import type { SystemGraph, SystemNet, SystemPin } from '../../../../domain/systemGraph';
import { readQsys } from '../../../../parser/system/QsysReader';
import { readQsysTcl } from '../../../../parser/system/QsysTclReader';

const REPO = path.join(__dirname, '../../../../..');
const FIXTURE = path.join(REPO, 'src/test/fixtures/system-design/niosv_hps_system.tcl');
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

function net(graph: SystemGraph, name: string): SystemNet {
  const found = graph.nets.find((n) => n.id === `/::${name}`);
  if (!found) {
    throw new Error(`no net /::${name}`);
  }
  return found;
}

const refs = (n: SystemNet) =>
  n.endpoints.map((e) => (e.instance === null ? `:${e.pin}` : `${e.instance}.${e.pin}`));

const read = (body: string) => readQsysTcl(body, 's.tcl');
const message = (graph: SystemGraph, start: string) =>
  graph.diagnostics.find((d) => d.message.startsWith(start));

describe('readQsysTcl: niosv_hps_system fixture', () => {
  const graph = readQsysTcl(fixtureText, FIXTURE);

  it('reads metadata', () => {
    expect(graph.name).toBe('niosv_hps_system');
    expect(graph.levels['/'].name).toBe('niosv_hps_system');
    expect(graph.source).toEqual({ fileName: FIXTURE, format: 'qsys-tcl' });
    expect(Object.keys(graph.levels)).toEqual(['/']);
  });

  it('reads enabled modules as flat ip instances and drops the disabled one', () => {
    expect(graph.levels['/'].instances).toEqual([
      '/clk_0',
      '/reset_bridge',
      '/niosv',
      '/hps_0',
      '/onchip_mem',
      '/jtag_uart',
      '/led_pio',
      '/button_pio',
      '/accel',
    ]);
    expect(graph.instances['/spare_pio']).toBeUndefined();
    expect(graph.instances['/niosv']).toMatchObject({
      kind: 'ip',
      component: 'intel_niosv_m',
      version: '25.1',
      parent: '/',
      line: lineOf('add_instance niosv'),
    });
    expect(graph.instances['/hps_0'].version).toBeUndefined();
  });

  it('applies parameters set after the instance and keeps their keys as written', () => {
    expect(graph.instances['/clk_0'].parameters).toEqual({ EXPLICIT_CLOCK_RATE: '50000000.0' });
    expect(graph.instances['/led_pio'].parameters).toEqual({ width: '8' });
  });

  it('groups connections into nets by start endpoint, substituting set variables', () => {
    expect(refs(net(graph, 'clk_0.out_clk'))).toEqual([
      '/clk_0.out_clk',
      '/reset_bridge.clk',
      '/niosv.clk',
      '/onchip_mem.clk1',
      '/jtag_uart.clk',
      '/led_pio.clk',
      '/button_pio.clk',
      '/accel.clk',
      '/hps_0.h2f_lw_axi_clock',
    ]);
    expect(refs(net(graph, 'niosv.data_manager'))).toEqual([
      '/niosv.data_manager',
      '/onchip_mem.s1',
      '/jtag_uart.avalon_jtag_slave',
      '/led_pio.s1',
      '/niosv.timer_sw_agent',
      '/niosv.dm_agent',
    ]);
  });

  it('records how each net kind was decided', () => {
    const summary = (name: string) => {
      const n = net(graph, name);
      return [n.category, n.categorySource, n.isInterface];
    };
    expect(summary('clk_0.out_clk')).toEqual(['clock', 'name', false]);
    expect(summary('reset_bridge.out_reset')).toEqual(['reset', 'name', false]);
    expect(summary('hps_0.h2f_reset')).toEqual(['reset', 'name', false]);
    expect(summary('niosv.data_manager')).toEqual(['avalonmm', 'declared', true]);
    expect(summary('niosv.instruction_manager')).toEqual(['avalonmm', 'declared', true]);
    expect(summary('niosv.platform_irq_rx')).toEqual(['interrupt', 'declared', false]);
    expect(summary('hps_0.h2f_lw_axi_master')).toEqual(['avalonmm', 'declared', true]);
    expect(summary('accel.avm')).toEqual(['avalonmm', 'name', true]);
    expect(summary('hps_0.f2h_irq0')).toEqual(['interrupt', 'name', false]);
    expect(summary('accel.status')).toEqual(['interface', 'default', true]);
    expect(summary('accel.trigger')).toEqual(['clock', 'declared', false]);
  });

  it('puts the interrupt receiver (the start) as an input and the sender as an output', () => {
    expect(pin(graph, '/niosv', 'platform_irq_rx')).toMatchObject({
      direction: 'in',
      directionSource: 'connection',
      signalType: 'intr',
      interfaceType: 'interrupt',
    });
    expect(pin(graph, '/jtag_uart', 'irq').direction).toBe('out');
    expect(pin(graph, '/clk_0', 'out_clk').direction).toBe('out');
    expect(pin(graph, '/niosv', 'data_manager')).toMatchObject({
      direction: 'master',
      isInterface: true,
    });
  });

  it('reads exported interfaces as boundary pins joined to nets', () => {
    expect(graph.levels['/'].boundaryPins.map((p) => p.name)).toEqual([
      'clk',
      'reset',
      'led_external_connection',
      'debug_probe',
    ]);
    expect(graph.levels['/'].boundaryPins[0]).toMatchObject({
      direction: 'in',
      directionSource: 'declared',
      interfaceType: 'clock',
      line: lineOf('add_interface clk'),
    });
    expect(refs(net(graph, 'led_external_connection'))).toEqual([
      ':led_external_connection',
      '/led_pio.external_connection',
    ]);
    expect(refs(net(graph, 'hps_0.h2f_reset')).slice(-1)).toEqual(['/accel.reset']);
  });

  it('keeps an interface without EXPORT_OF as an unconnected boundary pin, silently', () => {
    expect(
      graph.nets.some((n) => n.endpoints.some((e) => e.pin === 'debug_probe' && !e.instance))
    ).toBe(false);
    expect(graph.diagnostics.filter((d) => /^(?:Exported|EXPORT_OF)/.test(d.message))).toEqual([]);
  });

  it('turns memory-mapped connections into address segments with their base addresses', () => {
    const offsets = graph.addressSegments.map((s) => `${s.segment}=${s.offset}`);
    expect(offsets).toEqual(
      expect.arrayContaining([
        'onchip_mem.s1=0x00000000',
        'jtag_uart.avalon_jtag_slave=0x00010100',
        'led_pio.s1=0x00010010',
        'button_pio.s1=0x0000',
        'accel.avs=0x1000',
        'niosv.dm_agent=undefined',
      ])
    );
    expect(graph.addressSegments.find((s) => s.segment === 'accel.avs')).toMatchObject({
      addressSpace: 'hps_0.h2f_lw_axi_master',
      masterInstance: '/hps_0',
      slaveInstance: '/accel',
      line: lineOf('add_connection hps_0.h2f_lw_axi_master accel.avs'),
    });
  });

  it('reports the disabled module, inference, unknown kinds, the loop and skipped commands', () => {
    expect(message(graph, 'Skipped disabled modules')).toMatchObject({
      severity: 'info',
      message: 'Skipped disabled modules: spare_pio',
      lines: [lineOf('add_instance spare_pio')],
    });
    expect(message(graph, 'Connection types were partly inferred')?.severity).toBe('info');
    expect(message(graph, 'Connection type unknown')).toMatchObject({
      severity: 'info',
      message: 'Connection type unknown: accel.status -> accel.debug_probe',
      lines: [lineOf('add_connection accel.status')],
    });
    expect(message(graph, 'foreach cannot be evaluated offline')).toMatchObject({
      severity: 'warning',
      message: 'foreach cannot be evaluated offline; the system may be incomplete.',
      lines: [lineOf('foreach target')],
    });
    expect(message(graph, 'Base addresses are assigned')).toMatchObject({
      severity: 'info',
      lines: [lineOf('auto_assign_system_base_addresses')],
    });
    expect(message(graph, 'Skipped unsupported commands')).toBeUndefined();
  });

  it('is partial because of the loop, with the address map partial', () => {
    expect(graph.capabilities).toEqual({
      hierarchy: 'complete',
      connections: 'partial',
      addressMap: 'partial',
      userParameters: 'complete',
      propagatedParameters: 'unavailable',
      unconnectedPins: 'unavailable',
    });
  });

  it('reports lines of the logical line start, across comments and continuations', () => {
    expect(net(graph, 'clk_0.out_clk').line).toBe(
      lineOf('add_connection clk_0.out_clk reset_bridge')
    );
    const continued = lineOf('set_connection_parameter_value hps_0.h2f_lw_axi_master/accel.avs');
    const loop = message(graph, 'foreach cannot be evaluated offline')?.lines?.[0];
    // The continued command spans two physical lines, so later lines are offset by two.
    expect(loop).toBe(lineOf('foreach target'));
    expect(loop).toBeGreaterThan(continued + 2);
    expect(graph.addressSegments.find((s) => s.segment === 'accel.avs')?.offset).toBe('0x1000');
  });
});

describe('readQsysTcl: commands', () => {
  it('names the system from create_system, else the file', () => {
    expect(read('create_system top').name).toBe('top');
    expect(readQsysTcl('add_instance a b', '/p/my_design.tcl').name).toBe('my_design');
  });

  it('does not depend on the order of parameter and property commands', () => {
    const graph = read(
      [
        'set_instance_parameter_value a W 8',
        'set_instance_property a ENABLED 0',
        'add_instance a comp',
        'add_instance b comp',
        'add_connection a.x b.y clock',
      ].join('\n')
    );
    expect(graph.instances['/a']).toBeUndefined();
    expect(graph.nets).toEqual([]);
    expect(message(graph, 'Skipped disabled modules')?.lines).toEqual([3]);
  });

  it('applies connection parameters by the start/end id and warns for unknown ones', () => {
    const graph = read(
      [
        'add_instance a c',
        'add_instance b c',
        'add_connection a.m b.s avalon',
        'set_connection_parameter_value a.m/b.s baseAddress {0x40}',
        'set_connection_parameter_value a.m/zz.s baseAddress {0x80}',
      ].join('\n')
    );
    expect(graph.addressSegments[0].offset).toBe('0x40');
    expect(message(graph, 'Parameter baseAddress set on unknown connection')).toMatchObject({
      severity: 'warning',
      message: 'Parameter baseAddress set on unknown connection a.m/zz.s.',
      lines: [5],
    });
    expect(graph.capabilities.connections).toBe('partial');
  });

  it('warns about parameters set on an unknown instance', () => {
    const graph = read('add_instance a c\nset_instance_parameter_value ghost W 8');
    expect(message(graph, 'Parameter W')).toMatchObject({
      severity: 'warning',
      message: 'Parameter W set on unknown instance ghost.',
      lines: [2],
    });
  });

  it('keeps a quoted multi-word value as one value', () => {
    const graph = read('add_instance a c\nset_instance_parameter_value a NAME "my cpu"');
    expect(graph.instances['/a'].parameters).toEqual({ NAME: 'my cpu' });
  });

  it('lets the last ENABLED value win and warns for an unknown instance', () => {
    const graph = read(
      [
        'add_instance a c',
        'set_instance_property a ENABLED false',
        'set_instance_property a ENABLED true',
        'add_instance b c',
        'set_instance_property b ENABLED false',
        'set_instance_property b ENABLED 1',
        'add_instance d c',
        'set_instance_property d ENABLED 0',
        'set_instance_property ghost ENABLED false',
      ].join('\n')
    );
    expect(graph.levels['/'].instances).toEqual(['/a', '/b']);
    expect(message(graph, 'Property ENABLED')).toMatchObject({
      severity: 'warning',
      message: 'Property ENABLED set on unknown instance ghost.',
      lines: [9],
    });
  });

  it('warns about a variable that is not set, with the command lines', () => {
    const graph = read(
      [
        'set known x',
        'add_instance $missing c',
        'add_instance ok_$known c',
        'add_instance $other c',
      ].join('\n')
    );
    expect(message(graph, 'Variable $missing')).toMatchObject({
      severity: 'warning',
      message: 'Variable $missing is not set; add_instance may be wrong.',
      lines: [2],
    });
    expect(message(graph, 'Variable $other')?.lines).toEqual([4]);
    expect(graph.capabilities.connections).toBe('partial');
  });

  it('treats an unknown command that opens a multi-line block as unresolvable', () => {
    const graph = read(
      [
        'add_instance a c',
        'catch {',
        '  add_instance hidden c',
        '}',
        'namespace eval x {',
        '}',
      ].join('\n')
    );
    expect(graph.levels['/'].instances).toEqual(['/a']);
    expect(
      graph.diagnostics
        .filter((d) => d.severity === 'warning')
        .map((w) => [w.message.split(' ')[0], w.lines])
    ).toEqual([
      ['catch', [2]],
      ['namespace', [5]],
    ]);
    expect(graph.capabilities.connections).toBe('partial');
  });

  it('maps interface directions and warns for EXPORT_OF on an undeclared interface', () => {
    const graph = read(
      [
        'add_instance a c',
        'add_interface i1 conduit source',
        'add_interface i2 conduit sink',
        'add_interface i3 conduit weird',
        'add_interface i4 conduit receiver',
        'set_interface_property i1 EXPORT_OF a.p',
        'set_interface_property i1 ENABLED true',
        'set_interface_property nope EXPORT_OF a.q',
      ].join('\n')
    );
    const dirs = graph.levels['/'].boundaryPins.map((p) => `${p.name}:${p.direction}`);
    expect(dirs).toEqual(['i1:master', 'i2:slave', 'i3:slave', 'i4:master']);
    expect(message(graph, 'EXPORT_OF set')).toMatchObject({
      severity: 'warning',
      lines: [8],
    });
  });

  it('warns once per command name with every line, for commands that cannot be evaluated', () => {
    const graph = read(
      [
        'add_instance a c',
        'proc helper {} {',
        '  add_instance hidden c',
        '}',
        'source other.tcl',
        'if {1} {',
        '  add_instance inside c',
        '}',
        'add_instance b [get_x]',
        'add_instance d [get_y]',
        'exec ls',
      ].join('\n')
    );
    expect(graph.levels['/'].instances).toEqual(['/a']);
    const warnings = graph.diagnostics.filter((d) => d.severity === 'warning');
    expect(warnings.map((w) => [w.message.split(' ')[0], w.lines])).toEqual([
      ['proc', [2]],
      ['source', [5]],
      ['if', [6]],
      ['add_instance', [9, 10]],
      ['exec', [11]],
    ]);
    expect(graph.capabilities.connections).toBe('partial');
  });

  it('stays silent for known housekeeping commands and lists the other commands once', () => {
    const graph = read(
      [
        'package require -exact qsys 12.0',
        'set_project_property DEVICE_FAMILY {Cyclone V}',
        'load_system a.qsys',
        'sync_sysinfo_parameters',
        'set_validation_property AUTOMATIC_VALIDATION false',
        'validate_system',
        'save_system a.qsys',
        'puts done',
        'add_instance a c',
        'set_domain_assignment a.x foo bar',
        'set_domain_assignment a.y foo bar',
        'create_clock_thing',
      ].join('\n')
    );
    expect(graph.diagnostics).toEqual([
      {
        severity: 'info',
        message: 'Skipped unsupported commands: set_domain_assignment, create_clock_thing',
        lines: [10, 11, 12],
      },
    ]);
    expect(graph.capabilities.connections).toBe('complete');
  });

  it('reports duplicate and unknown modules like the .qsys reader', () => {
    const graph = read(
      ['add_instance a c', 'add_instance a c', 'add_connection a.x ghost.y clock'].join('\n')
    );
    expect(graph.diagnostics.map((d) => [d.message, d.lines])).toEqual([
      ['Duplicate module a; the first definition is used.', [1, 2]],
      ['Connection a.x -> ghost.y refers to unknown module ghost.', [3]],
    ]);
  });
});

describe('readQsysTcl: equivalence with the .qsys reader', () => {
  const tcl = [
    'create_system s',
    'add_instance clk_0 clock_source 1.0',
    'add_instance cpu nios 2.0',
    'add_instance mem ram 1',
    'set_instance_parameter_value cpu W 8',
    'add_connection clk_0.clk cpu.clk clock',
    'add_connection cpu.data_master mem.s1 avalon',
    'add_connection cpu.irq mem.irq interrupt',
    'set_connection_parameter_value cpu.data_master/mem.s1 baseAddress {0x100}',
    'set_connection_parameter_value cpu.irq/mem.irq irqNumber {3}',
    'add_interface clk clock sink',
    'set_interface_property clk EXPORT_OF clk_0.clk_in',
    'add_interface out conduit end',
    'set_interface_property out EXPORT_OF mem.out',
  ].join('\n');
  const xml = `<?xml version="1.0"?>
<system name="s">
 <module name="clk_0" kind="clock_source" version="1.0" />
 <module name="cpu" kind="nios" version="2.0"><parameter name="W" value="8" /></module>
 <module name="mem" kind="ram" version="1" />
 <connection start="clk_0.clk" end="cpu.clk" kind="clock" />
 <connection start="cpu.data_master" end="mem.s1" kind="avalon">
  <parameter name="baseAddress" value="0x100" />
 </connection>
 <connection start="cpu.irq" end="mem.irq" kind="interrupt">
  <parameter name="irqNumber" value="3" />
 </connection>
 <interface name="clk" internal="clk_0.clk_in" type="clock" dir="end" />
 <interface name="out" internal="mem.out" type="conduit" dir="end" />
</system>`;

  /** Drops what legitimately differs: the format and every line number. */
  const normalize = (graph: SystemGraph): unknown =>
    JSON.parse(JSON.stringify(graph), (key, value: unknown) =>
      key === 'line' || key === 'lines' ? undefined : value
    ) as unknown;

  it('produces the same graph apart from format and lines', () => {
    const fromTcl = readQsysTcl(tcl, 's.qsys');
    const fromXml = readQsys(xml, 's.qsys');
    expect(fromTcl.source.format).toBe('qsys-tcl');
    const a = normalize(fromTcl) as SystemGraph;
    const b = normalize(fromXml) as SystemGraph;
    a.source.format = b.source.format;
    expect(a).toEqual(b);
  });
});
