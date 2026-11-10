import * as fs from 'fs';
import * as path from 'path';
import type { SystemGraph, SystemNet, SystemPin } from '../../../../domain/systemGraph';
import { readQsys } from '../../../../parser/system/QsysReader';

const REPO = path.join(__dirname, '../../../../..');
const FIXTURE = path.join(REPO, 'src/test/fixtures/system-design/nios_avalon_system.qsys');
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

const system = (body: string) => `<?xml version="1.0"?>\n<system name="s">\n${body}\n</system>`;

describe('readQsys: nios_avalon_system fixture', () => {
  const graph = readQsys(fixtureText, FIXTURE);

  it('reads metadata and takes the name from the file for $${FILENAME}', () => {
    expect(graph.name).toBe('nios_avalon_system');
    expect(graph.levels['/'].name).toBe('nios_avalon_system');
    expect(graph.source).toEqual({ fileName: FIXTURE, format: 'qsys' });
  });

  it('reads enabled modules as flat ip instances with component, version, parameters, line', () => {
    expect(graph.levels['/'].instances).toEqual([
      '/clk_0',
      '/nios2_gen2_0',
      '/onchip_memory2_0',
      '/jtag_uart_0',
      '/sysid_qsys_0',
      '/pio_0',
      '/st_source_0',
      '/st_sink_0',
    ]);
    expect(Object.keys(graph.levels)).toEqual(['/']);
    expect(graph.instances['/nios2_gen2_0']).toMatchObject({
      path: '/nios2_gen2_0',
      name: 'nios2_gen2_0',
      parent: '/',
      kind: 'ip',
      component: 'altera_nios2_gen2',
      version: '18.1',
      line: lineOf('<module name="nios2_gen2_0"'),
    });
    expect(graph.instances['/nios2_gen2_0'].vlnv).toBeUndefined();
    expect(graph.instances['/clk_0'].parameters).toEqual({
      clockFrequency: '50000000',
      clockFrequencyKnown: 'true',
      resetSynchronousEdges: 'NONE',
    });
    expect(graph.instances['/spare_timer_0']).toBeUndefined();
  });

  it('skips disabled modules and the connections touching them with one info diagnostic', () => {
    expect(graph.diagnostics).toEqual([
      {
        severity: 'info',
        message: 'Skipped disabled modules: spare_timer_0',
        lines: [lineOf('<module name="spare_timer_0"')],
      },
    ]);
    expect(graph.addressSegments.map((s) => s.segment)).not.toContain('spare_timer_0.s1');
    expect(refs(net(graph, 'clk_0.clk')).join()).not.toContain('spare_timer_0');
  });

  it('groups connections by start, in document order, with the start first', () => {
    expect(graph.nets.map((n) => n.id)).toEqual([
      '/::nios2_gen2_0.data_master',
      '/::nios2_gen2_0.instruction_master',
      '/::st_source_0.src',
      '/::clk_0.clk',
      '/::clk_0.clk_reset',
      '/::nios2_gen2_0.debug_reset_request',
      '/::nios2_gen2_0.irq',
      '/::clk',
      '/::reset',
      '/::pio_0_external_connection',
    ]);
    expect(refs(net(graph, 'nios2_gen2_0.data_master'))).toEqual([
      '/nios2_gen2_0.data_master',
      '/onchip_memory2_0.s1',
      '/jtag_uart_0.avalon_jtag_slave',
      '/sysid_qsys_0.control_slave',
      '/pio_0.s1',
    ]);
    expect(refs(net(graph, 'nios2_gen2_0.irq'))).toEqual([
      '/nios2_gen2_0.irq',
      '/jtag_uart_0.irq',
      '/pio_0.irq',
    ]);
    const clock = net(graph, 'clk_0.clk');
    expect(clock).toMatchObject({
      name: 'clk_0.clk',
      level: '/',
      isInterface: false,
      category: 'clock',
      categorySource: 'declared',
      line: lineOf('end="nios2_gen2_0.clk"'),
    });
    expect(clock.endpoints).toHaveLength(8);
    expect(refs(net(graph, 'nios2_gen2_0.debug_reset_request'))).toEqual([
      '/nios2_gen2_0.debug_reset_request',
      '/onchip_memory2_0.reset1',
      '/jtag_uart_0.reset',
      '/pio_0.reset',
    ]);
  });

  it('classifies net categories from the connection kind', () => {
    expect(net(graph, 'nios2_gen2_0.data_master')).toMatchObject({
      category: 'avalonmm',
      isInterface: true,
    });
    expect(net(graph, 'st_source_0.src')).toMatchObject({
      category: 'avalonst',
      isInterface: true,
    });
    expect(net(graph, 'clk_0.clk_reset').category).toBe('reset');
    expect(net(graph, 'nios2_gen2_0.irq')).toMatchObject({
      category: 'interrupt',
      isInterface: false,
    });
  });

  it('derives pin directions from start/end per connection type', () => {
    expect(pin(graph, '/clk_0', 'clk')).toMatchObject({
      direction: 'out',
      directionSource: 'connection',
      interfaceType: 'clock',
      signalType: 'clk',
      isInterface: false,
    });
    expect(pin(graph, '/nios2_gen2_0', 'clk').direction).toBe('in');
    expect(pin(graph, '/clk_0', 'clk_reset')).toMatchObject({
      direction: 'out',
      signalType: 'rst',
    });
    expect(pin(graph, '/nios2_gen2_0', 'reset').direction).toBe('in');
    // The interrupt receiver is the connection start, the sender its end.
    expect(pin(graph, '/nios2_gen2_0', 'irq')).toMatchObject({
      direction: 'in',
      signalType: 'intr',
      interfaceType: 'interrupt',
    });
    expect(pin(graph, '/jtag_uart_0', 'irq').direction).toBe('out');
    expect(pin(graph, '/nios2_gen2_0', 'data_master')).toMatchObject({
      direction: 'master',
      isInterface: true,
      interfaceType: 'avalon',
    });
    expect(pin(graph, '/pio_0', 's1').direction).toBe('slave');
    expect(pin(graph, '/st_source_0', 'src').direction).toBe('master');
    expect(pin(graph, '/st_sink_0', 'sink')).toMatchObject({
      direction: 'slave',
      interfaceType: 'avalon_streaming',
    });
  });

  it('keeps the first direction of a pin that is a start once and an end later', () => {
    const twice = readQsys(
      system(
        ` <module name="a" kind="k" version="1" />\n <module name="b" kind="k" version="1" />\n` +
          ` <connection kind="clock" start="a.p" end="b.q" />\n` +
          ` <connection kind="clock" start="b.r" end="a.p" />`
      ),
      'a.qsys'
    );
    expect(pin(twice, '/a', 'p').direction).toBe('out');
    expect(twice.instances['/a'].pins.filter((p) => p.name === 'p')).toHaveLength(1);
  });

  it('exports interfaces as root boundary pins with their nets', () => {
    expect(graph.levels['/'].boundaryPins).toEqual([
      {
        name: 'clk',
        isInterface: false,
        direction: 'in',
        directionSource: 'declared',
        interfaceType: 'clock',
        signalType: 'clk',
        parameters: {},
        line: lineOf('<interface name="clk"'),
      },
      expect.objectContaining({ name: 'reset', direction: 'in', signalType: 'rst' }),
      expect.objectContaining({
        name: 'pio_0_external_connection',
        isInterface: true,
        direction: 'slave',
        interfaceType: 'conduit',
      }),
    ]);
    expect(refs(net(graph, 'clk'))).toEqual([':clk', '/clk_0.clk_in']);
    expect(net(graph, 'pio_0_external_connection')).toMatchObject({
      isInterface: true,
      category: 'interface',
      categorySource: 'declared',
    });
    expect(pin(graph, '/clk_0', 'clk_in')).toMatchObject({
      direction: 'in',
      directionSource: 'declared',
    });
  });

  it('records address segments with offsets and no ranges', () => {
    expect(graph.addressSegments).toHaveLength(5);
    expect(graph.addressSegments[0]).toEqual({
      addressSpace: 'nios2_gen2_0.data_master',
      segment: 'onchip_memory2_0.s1',
      masterInstance: '/nios2_gen2_0',
      slaveInstance: '/onchip_memory2_0',
      offset: '0x00004000',
      line: lineOf('end="onchip_memory2_0.s1"'),
    });
    expect(graph.addressSegments.map((s) => s.offset)).toEqual([
      '0x00004000',
      '0x00011000',
      '0x00011008',
      '0x00011010',
      '0x00004000',
    ]);
    expect(graph.addressSegments.every((s) => s.range === undefined)).toBe(true);
  });

  it('reports capabilities', () => {
    expect(graph.capabilities).toEqual({
      hierarchy: 'complete',
      connections: 'complete',
      addressMap: 'partial',
      userParameters: 'complete',
      propagatedParameters: 'unavailable',
      unconnectedPins: 'unavailable',
    });
  });
});

describe('readQsys: IPCraft minimal files', () => {
  const files = [
    'src/test/fixtures/system-design/comprehensive_avalon_test.qsys',
    'examples/regmap_conformance_avmm/altera/test.qsys',
  ];
  for (const file of files) {
    it(`reads ${file} without diagnostics`, () => {
      const graph = readQsys(fs.readFileSync(path.join(REPO, file), 'utf8'), file);
      expect(graph.name).toBe('test');
      expect(graph.diagnostics).toEqual([]);
      expect(graph.capabilities.connections).toBe('complete');
      expect(graph.capabilities.addressMap).toBe('complete');
      expect(graph.levels['/'].instances).toHaveLength(1);
      expect(graph.levels['/'].boundaryPins.length).toBeGreaterThan(0);
      expect(graph.nets).toHaveLength(graph.levels['/'].boundaryPins.length);
    });
  }

  it('maps exported interface dir to the end table', () => {
    const file = 'src/test/fixtures/system-design/comprehensive_avalon_test.qsys';
    const graph = readQsys(fs.readFileSync(path.join(REPO, file), 'utf8'), file);
    const boundary = (name: string) => graph.levels['/'].boundaryPins.find((p) => p.name === name)!;
    expect(boundary('comprehensive_avalon_0_S_AVMM')).toMatchObject({ direction: 'slave' });
    expect(boundary('comprehensive_avalon_0_SRC_ST').direction).toBe('master');
    expect(boundary('comprehensive_avalon_0_SNK_ST').direction).toBe('slave');
    expect(boundary('comprehensive_avalon_0_o_irq_n').direction).toBe('out');
  });
});

describe('readQsys: errors and warnings', () => {
  it('throws on malformed XML', () => {
    expect(() => readQsys('<system>\n<module name="a">\n</system>', 'a.qsys')).toThrow(
      /^Opening and ending tag mismatch: "module" != "system" \(line 2\)$/
    );
  });

  it('does not add a line suffix when the parser reports no line', () => {
    let message = '';
    try {
      readQsys('', 'a.qsys');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain('(line 0)');
  });

  it('throws when the root element is not <system>', () => {
    expect(() => readQsys('<project name="a"/>', 'a.qsys')).toThrow(
      'Not a Platform Designer system: the root element is <project>.'
    );
  });

  it('shows an undeclared connected module as a black box and keeps the connection', () => {
    const graph = readQsys(
      system(
        ` <module name="a" kind="k" version="1" />\n` +
          ` <connection kind="clock" start="a.clk" end="ghost.clk" />`
      ),
      'a.qsys'
    );
    expect(graph.diagnostics).toEqual([
      {
        severity: 'warning',
        message: 'Not defined in this file, shown as a black box: ghost',
        lines: [4],
      },
    ]);
    expect(graph.instances['/ghost']).toMatchObject({
      kind: 'blackbox',
      parent: '/',
      line: 4,
      pins: [expect.objectContaining({ name: 'clk' })],
    });
    expect(graph.levels['/'].instances).toContain('/ghost');
    expect(graph.nets).toHaveLength(1);
    expect(graph.nets[0].endpoints).toContainEqual({ instance: '/ghost', pin: 'clk' });
    expect(graph.capabilities.connections).toBe('partial');
  });

  it('keeps an exported interface of an undeclared module on a black box', () => {
    const graph = readQsys(
      system(` <interface name="x" internal="ghost.clk" type="clock" dir="end" />`),
      'a.qsys'
    );
    expect(graph.diagnostics).toEqual([
      {
        severity: 'warning',
        message: 'Not defined in this file, shown as a black box: ghost',
        lines: [3],
      },
    ]);
    expect(graph.instances['/ghost'].kind).toBe('blackbox');
    expect(graph.levels['/'].boundaryPins).toEqual([
      expect.objectContaining({ name: 'x', directionSource: 'declared', line: 3 }),
    ]);
    expect(graph.nets[0].endpoints).toEqual([
      { instance: null, pin: 'x' },
      { instance: '/ghost', pin: 'clk' },
    ]);
    expect(graph.capabilities.connections).toBe('partial');
  });

  it('keeps endpoint text as written, also without a dot', () => {
    const graph = readQsys(
      system(
        ` <module name="a" kind="k" version="1" />\n <module name="b" kind="k" version="1" />\n` +
          ` <connection kind="avalon" start="a" end="b"><parameter name="baseAddress" value="0x10" /></connection>`
      ),
      'a.qsys'
    );
    expect(graph.nets[0]).toMatchObject({ id: '/::a', name: 'a' });
    expect(graph.addressSegments[0]).toMatchObject({ addressSpace: 'a', segment: 'b' });
  });

  it.each(['constructor', '__proto__', 'toString'])(
    'treats the connection kind %s as a plain interface',
    (kind) => {
      const graph = readQsys(
        system(
          ` <module name="a" kind="k" version="1" />\n <module name="b" kind="k" version="1" />\n` +
            ` <connection kind="${kind}" start="a.x" end="b.y" />`
        ),
        'a.qsys'
      );
      expect(graph.nets[0]).toMatchObject({ category: 'interface', isInterface: true });
      expect(pin(graph, '/a', 'x').direction).toBe('master');
    }
  );

  it('warns about a duplicate module and uses the first definition', () => {
    const graph = readQsys(
      system(
        ` <module name="a" kind="first" version="1" />\n <module name="a" kind="second" version="2" />`
      ),
      'a.qsys'
    );
    expect(graph.diagnostics).toEqual([
      {
        severity: 'warning',
        message: 'Duplicate module a; the first definition is used.',
        lines: [3, 4],
      },
    ]);
    expect(graph.instances['/a'].component).toBe('first');
    expect(graph.levels['/'].instances).toEqual(['/a']);
    expect(graph.capabilities.connections).toBe('partial');
  });

  it('joins an exported endpoint that is already a connection start to that net', () => {
    const graph = readQsys(
      system(
        ` <interface name="clk_out" internal="a.clk" type="clock" dir="start" />\n` +
          ` <module name="a" kind="k" version="1" />\n` +
          ` <module name="b" kind="k" version="1" />\n` +
          ` <connection kind="clock" start="a.clk" end="b.clk" />`
      ),
      'a.qsys'
    );
    expect(graph.nets.map((n) => n.id)).toEqual(['/::a.clk']);
    expect(refs(graph.nets[0])).toEqual(['/a.clk', '/b.clk', ':clk_out']);
    expect(graph.levels['/'].boundaryPins[0]).toMatchObject({ name: 'clk_out', direction: 'out' });
  });

  it('skips exported interfaces of disabled modules without a warning', () => {
    const graph = readQsys(
      system(
        ` <module name="a" kind="k" version="1" enabled="0" />\n` +
          ` <interface name="x" internal="a.clk" type="clock" dir="end" />`
      ),
      'a.qsys'
    );
    expect(graph.levels['/'].boundaryPins).toEqual([]);
    expect(graph.nets).toEqual([]);
    expect(graph.diagnostics.map((d) => d.severity)).toEqual(['info']);
  });

  it('uses the file name when the system name is missing and reads CDATA parameters', () => {
    const graph = readQsys(
      '<system><module name="a" kind="k" version="1"><parameter name="p"><![CDATA[hello]]></parameter></module></system>',
      'dir/design.qsys'
    );
    expect(graph.name).toBe('design');
    expect(graph.instances['/a'].parameters).toEqual({ p: 'hello' });
  });

  it('reports unsupported elements once with all lines and ignores known ones', () => {
    const graph = readQsys(
      system(
        ` <interconnectRequirement for="$system" name="n" value="v" />\n` +
          ` <weird />\n <weird />\n <other />`
      ),
      'a.qsys'
    );
    expect(graph.diagnostics).toEqual([
      { severity: 'info', message: 'Skipped unsupported elements: weird, other', lines: [4, 5, 6] },
    ]);
  });

  it('classifies axi and other interface types', () => {
    const graph = readQsys(
      system(
        ` <module name="m" kind="k" version="1" />\n <module name="s" kind="k" version="1" />\n` +
          ` <connection kind="axi4" start="m.a" end="s.a"><parameter name="baseAddress" value="0x10" /></connection>\n` +
          ` <connection kind="axi4stream" start="m.b" end="s.b" />\n` +
          ` <connection kind="conduit" start="m.c" end="s.c" />`
      ),
      'a.qsys'
    );
    expect(graph.nets.map((n) => n.category)).toEqual(['aximm', 'axis', 'interface']);
    expect(graph.addressSegments).toHaveLength(1);
    expect(graph.addressSegments[0].offset).toBe('0x10');
  });
});

describe('readQsys: black box guards (#291)', () => {
  it('creates no black box for a missing endpoint attribute', () => {
    const graph = readQsys(
      system(
        ` <module name="a" kind="k" version="1" />\n` +
          ` <connection kind="clock" start="a.clk" />\n` +
          ` <interface name="x" type="clock" dir="end" />`
      ),
      'a.qsys'
    );
    expect(Object.keys(graph.instances)).toEqual(['/a']);
    expect(graph.levels['/'].instances).toEqual(['/a']);
    expect(graph.nets).toEqual([]);
    expect(graph.levels['/'].boundaryPins).toEqual([expect.objectContaining({ name: 'x' })]);
    expect(graph.diagnostics.every((d) => !d.message.includes('black box'))).toBe(true);
    expect(graph.diagnostics.map((d) => d.message)).toEqual([
      'Connection a.clk ->  refers to unknown module .',
      'Exported interface x refers to unknown module .',
    ]);
  });

  it('does not make a black box of a module only connected to a disabled module', () => {
    const graph = readQsys(
      system(
        ` <module name="off" kind="k" version="1" enabled="0" />\n` +
          ` <module name="a" kind="k" version="1" />\n` +
          ` <connection kind="clock" start="off.clk" end="ghost.clk" />\n` +
          ` <connection kind="clock" start="a.clk" end="other.clk" />`
      ),
      'a.qsys'
    );
    expect(graph.instances['/ghost']).toBeUndefined();
    expect(graph.instances['/other'].kind).toBe('blackbox');
    expect(graph.diagnostics.map((d) => d.message)).toContain(
      'Not defined in this file, shown as a black box: other'
    );
  });
});
