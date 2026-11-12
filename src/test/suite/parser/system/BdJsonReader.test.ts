import * as fs from 'fs';
import * as path from 'path';
import type { SystemGraph, SystemNet, SystemPin } from '../../../../domain/systemGraph';
import { readBdJson } from '../../../../parser/system/BdJsonReader';

const FIXTURE = path.join(__dirname, '../../../fixtures/system-design/zynq_gpio_system.bd');
const fixtureText = fs.readFileSync(FIXTURE, 'utf8');
const fixtureLines = fixtureText.split('\n');

/** 1-based line of the first line containing `pattern`, searching from line `after`. */
function lineOf(pattern: string, after = 0): number {
  const idx = fixtureLines.findIndex((l, i) => i >= after && l.includes(pattern));
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

describe('readBdJson: zynq_gpio_system fixture', () => {
  const graph = readBdJson(fixtureText, FIXTURE);
  const ports = lineOf('"ports": {', lineOf('"interface_ports"'));

  it('reads metadata', () => {
    expect(graph.name).toBe('zynq_gpio_system');
    expect(graph.source.format).toBe('vivado-bd');
    expect(graph.source.toolVersion).toBe('2022.2');
    expect(graph.source.fileName).toBe(FIXTURE);
  });

  it('reads levels and instances in file order with their kinds', () => {
    expect(Object.keys(graph.levels).sort()).toEqual(['/', '/gpio_block']);
    expect(graph.levels['/'].instances).toEqual([
      '/sys_ps7',
      '/axi_periph',
      '/axi_gpio_0',
      '/gpio_block',
      '/sync_0',
      '/ghost_ctrl',
    ]);
    expect(graph.levels['/gpio_block'].instances).toEqual(['/gpio_block/axi_gpio_1']);
    expect(graph.instances['/sys_ps7']).toMatchObject({
      kind: 'ip',
      vlnv: 'xilinx.com:ip:processing_system7:5.5',
      parent: '/',
      line: lineOf('"sys_ps7": {', lineOf('"components"')),
    });
    expect(graph.instances['/gpio_block']).toMatchObject({ kind: 'hier', parent: '/' });
    expect(graph.instances['/gpio_block/axi_gpio_1']).toMatchObject({
      kind: 'ip',
      parent: '/gpio_block',
      line: lineOf('"axi_gpio_1": {', lineOf('"gpio_block": {', lineOf('"components"'))),
    });
  });

  it('keeps an IP with an inner design as one block', () => {
    expect(graph.instances['/axi_periph'].kind).toBe('ip');
    expect(graph.levels['/axi_periph']).toBeUndefined();
    expect(graph.instances['/axi_periph/xbar']).toBeUndefined();
    expect(graph.nets.some((n) => n.level === '/axi_periph')).toBe(false);
  });

  it('marks only module references as listing every pin', () => {
    expect(graph.instances['/sync_0'].pinsComplete).toBe(true);
    expect(graph.instances['/sys_ps7'].pinsComplete).toBeUndefined();
    expect(graph.instances['/gpio_block'].pinsComplete).toBeUndefined();
    expect(graph.instances['/ghost_ctrl'].pinsComplete).toBeUndefined();
  });

  it('reads a module reference without a vlnv', () => {
    const sync = graph.instances['/sync_0'];
    expect(sync.kind).toBe('module');
    expect(sync.moduleRef).toBe('reset_synchronizer');
    expect(sync.vlnv).toBeUndefined();
    expect(pin(graph, '/sync_0', 'rst_n')).toMatchObject({
      direction: 'out',
      directionSource: 'declared',
      signalType: 'rst',
    });
  });

  it('reads root ports with direction, type, width and line', () => {
    const boundary = graph.levels['/'].boundaryPins;
    const byName = (name: string) => boundary.find((p) => p.name === name) as SystemPin;
    expect(byName('sys_clk')).toMatchObject({
      isInterface: false,
      direction: 'in',
      directionSource: 'declared',
      signalType: 'clk',
      line: lineOf('"sys_clk": {', ports),
    });
    expect(byName('sys_rst_n')).toMatchObject({ direction: 'in', signalType: 'rst' });
    expect(byName('led_o')).toMatchObject({
      direction: 'out',
      width: { from: 7, to: 0 },
      line: lineOf('"led_o": {'),
    });
    expect(byName('led_o').signalType).toBeUndefined();
    expect(byName('DDR')).toMatchObject({
      isInterface: true,
      direction: 'master',
      directionSource: 'declared',
      vlnv: 'xilinx.com:interface:ddrx_rtl:1.0',
      line: lineOf('"DDR": {'),
    });
  });

  it('declares the pins the file lists on ip instances', () => {
    expect(pin(graph, '/sys_ps7', 'M_AXI_GP0')).toMatchObject({
      isInterface: true,
      direction: 'master',
      directionSource: 'declared',
      vlnv: 'xilinx.com:interface:aximm_rtl:1.0',
      line: lineOf('"M_AXI_GP0": {'),
    });
    expect(graph.instances['/axi_gpio_0'].pins.filter((p) => p.name === 'S_AXI')).toHaveLength(1);
  });

  it('reads hierarchy ports and interface ports as boundary pins', () => {
    const boundary = graph.levels['/gpio_block'].boundaryPins.map((p) => p.name);
    expect(boundary).toEqual(['S_AXI', 'GPIO', 'clk', 'rst_n']);
    expect(pin(graph, '/gpio_block', 'GPIO').direction).toBe('master');
  });

  it('keeps only user-set parameters under CONFIG. keys (value_src user is kept)', () => {
    expect(graph.instances['/sys_ps7'].parameters).toEqual({
      'CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ': '100',
      'CONFIG.PCW_MIO_TREE_PERIPHERALS': 'GPIO#Quad SPI Flash#Quad SPI Flash#UART 1',
    });
    expect(graph.instances['/axi_gpio_0'].parameters).toEqual({ 'CONFIG.C_GPIO_WIDTH': '8' });
    const clk = graph.levels['/'].boundaryPins.find((p) => p.name === 'sys_clk') as SystemPin;
    expect(clk.parameters).toEqual({ 'CONFIG.FREQ_HZ': '125000000' });
    const ddr = graph.levels['/'].boundaryPins.find((p) => p.name === 'DDR') as SystemPin;
    expect(ddr.parameters).toEqual({});
  });

  it('reads scalar nets with endpoints relative to their level', () => {
    const fclk = net(graph, '/', 'fclk');
    expect(fclk.isInterface).toBe(false);
    expect(fclk.line).toBe(lineOf('"fclk": {'));
    expect(fclk.endpoints).toEqual([
      { instance: '/sys_ps7', pin: 'FCLK_CLK0' },
      { instance: '/axi_periph', pin: 'ACLK' },
      { instance: '/axi_gpio_0', pin: 's_axi_aclk' },
      { instance: '/gpio_block', pin: 'clk' },
    ]);
    const blockClk = net(graph, '/gpio_block', 'block_clk');
    expect(blockClk.endpoints).toEqual([
      { instance: null, pin: 'clk' },
      { instance: '/gpio_block/axi_gpio_1', pin: 's_axi_aclk' },
    ]);
    expect(blockClk.line).toBe(lineOf('"block_clk": {'));
  });

  it('reads interface nets, including boundary endpoints', () => {
    const ps = net(graph, '/', 'ps_axi');
    expect(ps.isInterface).toBe(true);
    expect(ps.category).toBe('aximm');
    expect(ps.line).toBe(lineOf('"ps_axi": {'));
    expect(ps.endpoints).toEqual([
      { instance: '/axi_periph', pin: 'S00_AXI' },
      { instance: '/sys_ps7', pin: 'M_AXI_GP0' },
    ]);
    expect(net(graph, '/', 'ps_ddr').endpoints[1]).toEqual({ instance: null, pin: 'DDR' });
    expect(net(graph, '/gpio_block', 'gpio_axi').line).toBe(lineOf('"gpio_axi": {'));
  });

  it('classifies nets and infers pin directions like the Tcl reader', () => {
    expect(net(graph, '/', 'fclk').category).toBe('clock');
    expect(net(graph, '/gpio_block', 'block_rst').category).toBe('reset');
    expect(pin(graph, '/axi_gpio_0', 's_axi_aclk').direction).toBe('in');
  });

  it('shows an undefined instance as a black box', () => {
    const ghost = graph.instances['/ghost_ctrl'];
    expect(ghost.kind).toBe('blackbox');
    expect(ghost.pins.map((p) => p.name)).toEqual(['rst_n']);
    expect(graph.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warning',
        message: expect.stringContaining('ghost_ctrl'),
        lines: [lineOf('"ext_rst": {')],
      })
    );
  });

  it('reads address segments with converted ranges', () => {
    const segments = graph.addressSegments;
    expect(segments.map((s) => s.segment)).toEqual([
      'axi_gpio_0/S_AXI/Reg',
      'gpio_block/axi_gpio_1/S_AXI/Reg',
      'axi_gpio_0/S_AXI/Mem',
    ]);
    expect(segments[0]).toEqual({
      addressSpace: 'sys_ps7/Data',
      segment: 'axi_gpio_0/S_AXI/Reg',
      masterInstance: '/sys_ps7',
      slaveInstance: '/axi_gpio_0',
      offset: '0x41200000',
      range: '0x00010000',
      line: lineOf('"SEG_axi_gpio_0_Reg": {'),
    });
    expect(segments[1]).toMatchObject({
      slaveInstance: '/gpio_block/axi_gpio_1',
      offset: '0x41210000',
      range: '0x00010000',
      line: lineOf('"SEG_axi_gpio_1_Reg": {'),
    });
    expect(segments[2].range).toBe('0x100000000');
  });

  it('skips excluded segments with one info diagnostic naming their lines', () => {
    expect(graph.addressSegments.some((s) => s.segment === 'axi_gpio_0/S_AXI/Reg2')).toBe(false);
    const skipped = graph.diagnostics.filter(
      (d) => d.message === 'Skipped excluded address segments'
    );
    expect(skipped).toEqual([
      {
        severity: 'info',
        message: 'Skipped excluded address segments',
        lines: [lineOf('"SEG_axi_gpio_2_Reg": {'), lineOf('"SEG_axi_gpio_3_Reg": {')],
      },
    ]);
  });
});

describe('readBdJson: small designs', () => {
  const read = (design: unknown, fileName = '/x/my_design.bd') =>
    readBdJson(JSON.stringify({ design }, null, 2), fileName);

  it('falls back to the file name and omits the tool version when absent', () => {
    const graph = read({ components: { a: { vlnv: 'x:ip:a:1.0' } } });
    expect(graph.name).toBe('my_design');
    expect(graph.source.toolVersion).toBeUndefined();
  });

  it('reads an unknown interface mode and unknown direction as unknown', () => {
    const graph = read({
      interface_ports: { mon: { mode: 'Monitor', vlnv: 'x:interface:y:1.0' } },
      ports: { p: { direction: 'X' } },
    });
    expect(graph.levels['/'].boundaryPins).toMatchObject([
      { name: 'mon', direction: 'unknown', directionSource: 'unknown' },
      { name: 'p', direction: 'unknown', directionSource: 'unknown' },
    ]);
  });

  it('maps MirroredMaster and inout ports', () => {
    const graph = read({
      interface_ports: { m: { mode: 'MirroredMaster' }, s: { mode: 'MirroredSlave' } },
      ports: { io: { direction: 'IO', type: 'data' } },
    });
    const pins = graph.levels['/'].boundaryPins;
    expect(pins.map((p) => p.direction)).toEqual(['slave', 'master', 'inout']);
    expect(pins[2].signalType).toBe('data');
  });

  it('converts K, M, G and T ranges to padded hex and keeps other ranges', () => {
    const segment = (range: string, name: string) => ({
      [name]: { address_block: `/${name}/S/Reg`, offset: '0x0', range },
    });
    const graph = read({
      components: {},
      addressing: {
        '/cpu': {
          address_spaces: {
            Data: {
              segments: {
                ...segment('4K', 'a'),
                ...segment('1M', 'b'),
                ...segment('2G', 'c'),
                ...segment('1T', 'd'),
                ...segment('0x1000', 'e'),
              },
            },
          },
        },
      },
    });
    expect(graph.addressSegments.map((s) => s.range)).toEqual([
      '0x00001000',
      '0x00100000',
      '0x80000000',
      '0x10000000000',
      '0x1000',
    ]);
  });

  it('treats is_excluded case-insensitively', () => {
    const graph = read({
      addressing: {
        '/cpu': {
          address_spaces: {
            Data: {
              segments: {
                x: { address_block: '/a/S/Reg', offset: '0x0', range: '4K', is_excluded: 'true' },
                y: { address_block: '/b/S/Reg', offset: '0x0', range: '4K', is_excluded: 'FALSE' },
              },
            },
          },
        },
      },
    });
    expect(graph.addressSegments.map((s) => s.segment)).toEqual(['b/S/Reg']);
    expect(graph.diagnostics).toContainEqual({
      severity: 'info',
      message: 'Skipped excluded address segments',
      lines: [expect.any(Number)],
    });
  });

  it('ignores unknown keys', () => {
    const graph = read({
      mystery: 1,
      components: { a: { vlnv: 'x:ip:a:1.0', future_key: { z: [] }, ports: { p: 5 } } },
      nets: { n: { ports: ['a/p', 3], extra: true } },
    });
    expect(graph.instances['/a'].kind).toBe('ip');
    expect(graph.nets[0].endpoints).toEqual([{ instance: '/a', pin: 'p' }]);
  });

  it('splits an endpoint at the last slash', () => {
    const graph = read({
      components: { h: { components: { c: { vlnv: 'x:ip:c:1.0' } } } },
      nets: { n: { ports: ['h/c/clk'] } },
    });
    expect(graph.nets[0].endpoints).toEqual([{ instance: '/h/c', pin: 'clk' }]);
  });
});

describe('readBdJson: errors', () => {
  it('rejects the XML format of Vivado 2018.2 and earlier', () => {
    expect(() => readBdJson('  \n<?xml version="1.0"?>\n<spirit:design/>', 'a.bd')).toThrow(
      'This .bd file uses the XML format of Vivado 2018.2 and earlier, which is not supported. Save it with Vivado 2018.3 or later, or export it with write_bd_tcl.'
    );
  });

  it('rejects invalid JSON with the parser reason', () => {
    expect(() => readBdJson('{ "design": ', 'a.bd')).toThrow(/not valid JSON: .+/);
  });

  it('rejects JSON without a design object', () => {
    const message = 'Not a Vivado block design: the file has no "design" object.';
    expect(() => readBdJson('{}', 'a.bd')).toThrow(message);
    expect(() => readBdJson('{"design": []}', 'a.bd')).toThrow(message);
    expect(() => readBdJson('[1]', 'a.bd')).toThrow(message);
    expect(() => readBdJson('null', 'a.bd')).toThrow(message);
  });
});
