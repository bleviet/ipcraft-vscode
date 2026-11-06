import type { SystemGraph } from '../../../../domain/systemGraph';
import { readBdTcl } from '../../../../parser/system/BdTclReader';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import { clockInputs, DOMAIN_COLORS } from '../../../../webview/systemDiagram/clocks/clockDomains';
import { formatHz } from '../../../../webview/systemDiagram/clocks/frequency';
import { loadQsysSubsystemGraph, loadQsysTwoClockGraph } from './clockTestGraphs';
import {
  loadClockFixtureGraph,
  loadFixtureGraph,
  loadQsysFixtureGraph,
  loadQsysTclFixtureGraph,
} from './fixtureGraph';

const DSP = '/dsp_pipeline';
const instancePin = (instance: string, pin: string) => ({ instance, pin });
const boundaryPin = (pin: string) => ({ instance: null, pin });

describe('clock domains of the clock fixture', () => {
  const graph = loadClockFixtureGraph();
  const analysis = analyzeClocks(graph);
  const domain = (name: string) => analysis.domains.find((candidate) => candidate.name === name)!;

  it('finds one domain per clock source, in the script order of the source nets', () => {
    expect(analysis.domains.map((candidate) => [candidate.index, candidate.name])).toEqual([
      [0, 'ext_clk'],
      [1, 'FCLK_CLK0'],
      [2, 'FCLK_CLK1'],
    ]);
    expect(analysis.domains.map((candidate) => candidate.color)).toEqual(DOMAIN_COLORS.slice(0, 3));
    expect(domain('FCLK_CLK0')).toMatchObject({
      id: 'clock:1',
      label: 'processing_system7_0/FCLK_CLK0',
      sourceLevel: '/',
      sourceRef: instancePin('/processing_system7_0', 'FCLK_CLK0'),
      sourceNetId: '/::processing_system7_0_FCLK_CLK0',
      line: graph.instances['/processing_system7_0'].line,
    });
  });

  it('reads the requested frequencies from the script', () => {
    expect(domain('FCLK_CLK0').hz).toBe(100e6);
    expect(domain('FCLK_CLK1').hz).toBe(200e6);
    expect(domain('FCLK_CLK0').frequencyFrom).toEqual({
      parameter: 'CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ',
      value: '100',
      text: 'CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ = 100',
      kind: 'script',
      owner: 'processing_system7_0',
      level: '/',
      line: graph.instances['/processing_system7_0'].line,
    });
  });

  it('counts loads and levels: FCLK_CLK0 reaches loads in two levels', () => {
    expect(domain('FCLK_CLK0')).toMatchObject({ loads: 8, levels: 2 });
    expect(domain('FCLK_CLK0').netIds).toEqual([
      `${DSP}::aclk_1`,
      '/::processing_system7_0_FCLK_CLK0',
    ]);
    expect(domain('FCLK_CLK1')).toMatchObject({ loads: 3, levels: 2 });
    expect(domain('ext_clk')).toMatchObject({ loads: 1, levels: 1 });
  });

  it('follows a domain through a hierarchy pin', () => {
    const fast = domain('FCLK_CLK1');
    expect(analysis.domainOfPin('/', instancePin(DSP, 'dsp_clk'))).toBe(fast);
    expect(analysis.domainOfPin(DSP, boundaryPin('dsp_clk'))).toBe(fast);
    expect(analysis.domainOfPin(DSP, instancePin(`${DSP}/fir_compiler_0`, 'aclk'))).toBe(fast);
    expect(analysis.domainOfNet(`${DSP}::dsp_clk_1`)).toBe(fast);
    expect(analysis.domainOfNet('/::processing_system7_0_FCLK_CLK1')).toBe(fast);
    expect(analysis.domainOfPin(DSP, instancePin(`${DSP}/axis_data_fifo_0`, 's_axis_aclk'))).toBe(
      domain('FCLK_CLK0')
    );
  });

  it('puts no domain on data, reset or unconnected pins', () => {
    expect(analysis.domainOfNet(`${DSP}::Conn1`)).toBeUndefined();
    expect(analysis.domainOfNet(`${DSP}::aresetn_1`)).toBeUndefined();
    expect(analysis.domainOfNet('/::nope')).toBeUndefined();
    expect(analysis.domainOfPin('/', instancePin('/axi_dma_0', 'M_AXI_MM2S'))).toBeUndefined();
  });

  it('reads CONFIG.FREQ_HZ of an external clock port as declared', () => {
    expect(domain('ext_clk')).toMatchObject({
      label: 'ext_clk',
      sourceRef: boundaryPin('ext_clk'),
      hz: 125e6,
      line: graph.levels['/'].boundaryPins.find((pin) => pin.name === 'ext_clk')?.line,
      frequencyFrom: {
        parameter: 'CONFIG.FREQ_HZ',
        text: 'CONFIG.FREQ_HZ = 125000000',
        kind: 'declared',
        owner: 'ext_clk',
        level: '/',
      },
    });
  });

  it('lists the distinct domains of an instance in domain order', () => {
    const fifo = `${DSP}/axis_data_fifo_0`;
    expect(analysis.instanceDomains(fifo).map((candidate) => candidate.name)).toEqual([
      'FCLK_CLK0',
      'FCLK_CLK1',
    ]);
    expect(analysis.instanceDomains(`${DSP}/fir_compiler_0`).map((d) => d.name)).toEqual([
      'FCLK_CLK1',
    ]);
    expect(analysis.instanceDomains('/axi_dma_0').map((d) => d.name)).toEqual(['FCLK_CLK0']);
    expect(analysis.instanceDomains(DSP).map((d) => d.name)).toEqual(['FCLK_CLK0', 'FCLK_CLK1']);
    expect(analysis.instanceDomains('/nope')).toEqual([]);
  });

  it('lists clock inputs as loads of clock nets, not the driver', () => {
    const names = (path: string) => analysis.clockInputs(path).map((pin) => pin.name);
    expect(names('/processing_system7_0')).toEqual(['M_AXI_GP0_ACLK']);
    expect(names(`${DSP}/axis_data_fifo_0`)).toEqual(['s_axis_aclk', 'm_axis_aclk']);
    expect(names(DSP)).toEqual(['aclk', 'dsp_clk']);
    expect(names('/rst_ps7_0_100M')).toEqual(['slowest_sync_clk']);
    expect(clockInputs(graph, '/axi_dma_0').map((pin) => pin.name)).toEqual(names('/axi_dma_0'));
    expect(clockInputs(graph, '/nope')).toEqual([]);
    expect(analysis.clockInputs('/nope')).toEqual([]);
  });

  it('counts a pin declared as a clock input even when no net touches it, but never an output', () => {
    const mutated = loadClockFixtureGraph();
    mutated.instances['/ext_fifo_0'].pins.push(
      {
        name: 'spare_clk',
        isInterface: false,
        direction: 'in',
        directionSource: 'definition',
        signalType: 'clk',
        parameters: {},
      },
      {
        name: 'clk_out',
        isInterface: false,
        direction: 'out',
        directionSource: 'definition',
        signalType: 'clk',
        parameters: {},
      }
    );
    expect(
      analyzeClocks(mutated)
        .clockInputs('/ext_fifo_0')
        .map((pin) => pin.name)
    ).toEqual(['s_axis_aclk', 'spare_clk']);
  });
});

describe('a clock net without a leaf pin', () => {
  it('makes no domain: nothing drives it', () => {
    const graph = loadClockFixtureGraph();
    const hierarchy = graph.instances[DSP];
    for (const name of ['lonely_in', 'lonely_out']) {
      hierarchy.pins.push({
        name,
        isInterface: false,
        direction: name === 'lonely_in' ? 'in' : 'out',
        directionSource: 'declared',
        signalType: 'clk',
        parameters: {},
      });
    }
    graph.nets.push({
      id: '/::lonely',
      name: 'lonely',
      level: '/',
      isInterface: false,
      category: 'clock',
      categorySource: 'declared',
      endpoints: [instancePin(DSP, 'lonely_out'), instancePin(DSP, 'lonely_in')],
      line: 1,
    });
    const analysis = analyzeClocks(graph);
    expect(analysis.domains.map((domain) => domain.name)).toEqual([
      'ext_clk',
      'FCLK_CLK0',
      'FCLK_CLK1',
    ]);
    expect(analysis.domainOfNet('/::lonely')).toBeUndefined();
  });
});

describe('frequency origins', () => {
  it('is unknown when the parameter is absent, never a vendor default', () => {
    const graph = loadClockFixtureGraph();
    delete graph.instances['/processing_system7_0'].parameters[
      'CONFIG.PCW_FPGA1_PERIPHERAL_FREQMHZ'
    ];
    const fast = analyzeClocks(graph).domains.find((d) => d.name === 'FCLK_CLK1')!;
    expect(fast.hz).toBeUndefined();
    expect(fast.frequencyFrom).toBeUndefined();
    expect(formatHz(fast.hz)).toBe('unknown');
  });

  it('falls back to CONFIG.FREQ_HZ on a hierarchy pin of the domain', () => {
    const graph = loadClockFixtureGraph();
    delete graph.instances['/processing_system7_0'].parameters[
      'CONFIG.PCW_FPGA1_PERIPHERAL_FREQMHZ'
    ];
    graph.levels[DSP].boundaryPins.find((pin) => pin.name === 'dsp_clk')!.parameters[
      'CONFIG.FREQ_HZ'
    ] = '210000000';
    const fast = analyzeClocks(graph).domains.find((d) => d.name === 'FCLK_CLK1')!;
    expect(fast.hz).toBe(210e6);
    expect(fast.frequencyFrom).toMatchObject({
      kind: 'declared',
      owner: 'dsp_clk',
      level: DSP,
      text: 'CONFIG.FREQ_HZ = 210000000',
    });
  });

  it('prefers the source rule over a hierarchy pin value', () => {
    const graph = loadClockFixtureGraph();
    graph.instances[DSP].pins.find((pin) => pin.name === 'dsp_clk')!.parameters['CONFIG.FREQ_HZ'] =
      '1';
    const fast = analyzeClocks(graph).domains.find((d) => d.name === 'FCLK_CLK1')!;
    expect(fast.hz).toBe(200e6);
  });

  it('ignores a source value that is not a number', () => {
    const graph = loadClockFixtureGraph();
    graph.instances['/processing_system7_0'].parameters['CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ'] =
      '$mhz';
    const slow = analyzeClocks(graph).domains.find((d) => d.name === 'FCLK_CLK0')!;
    expect(slow.hz).toBeUndefined();
  });
});

describe('domain names', () => {
  it('uses instanceName/pin when two domains share a pin name', () => {
    const graph = readBdTcl(
      [
        'create_bd_design "d"',
        'set ca [ create_bd_cell -type ip -vlnv xilinx.com:ip:clk_wiz:6.0 ca ]',
        'set cb [ create_bd_cell -type ip -vlnv xilinx.com:ip:clk_wiz:6.0 cb ]',
        'set x [ create_bd_cell -type ip -vlnv acme.com:ip:blk:1.0 x ]',
        'set y [ create_bd_cell -type ip -vlnv acme.com:ip:blk:1.0 y ]',
        'set_property CONFIG.CLKOUT1_REQUESTED_OUT_FREQ {100.000} $ca',
        'connect_bd_net -net na [get_bd_pins ca/clk_out1] [get_bd_pins x/clk]',
        'connect_bd_net -net nb [get_bd_pins cb/clk_out1] [get_bd_pins y/clk]',
        'connect_bd_net -net nc [get_bd_pins ca/clk_out2] [get_bd_pins y/clk2]',
      ].join('\n'),
      'd.tcl'
    );
    const names = analyzeClocks(graph).domains.map((d) => [d.name, d.label, d.hz]);
    expect(names).toEqual([
      ['ca/clk_out1', 'ca/clk_out1', 100e6],
      ['cb/clk_out1', 'cb/clk_out1', undefined],
      ['clk_out2', 'ca/clk_out2', undefined],
    ]);
  });
});

describe('clock domains of Platform Designer systems', () => {
  it('reads clock_source frequency and passes the domain through clk_in to clk', () => {
    const graph = loadQsysFixtureGraph();
    const analysis = analyzeClocks(graph);
    expect(analysis.domains).toHaveLength(1);
    const [domain] = analysis.domains;
    expect(domain).toMatchObject({ name: 'clk', hz: 50e6, sourceRef: boundaryPin('clk') });
    expect(domain.frequencyFrom).toMatchObject({
      parameter: 'clockFrequency',
      value: '50000000',
      kind: 'script',
      owner: 'clk_0',
    });
    // The exported clock port and every load behind clk_0 are one domain.
    expect(analysis.domainOfPin('/', boundaryPin('clk'))).toBe(domain);
    expect(analysis.domainOfPin('/', instancePin('/clk_0', 'clk_in'))).toBe(domain);
    expect(analysis.domainOfPin('/', instancePin('/clk_0', 'clk'))).toBe(domain);
    expect(analysis.domainOfPin('/', instancePin('/nios2_gen2_0', 'clk'))).toBe(domain);
    expect(domain.netIds).toEqual(['/::clk_0.clk', '/::clk']);
  });

  it('keeps the domains of two clock sources apart and reads both frequencies', () => {
    const analysis = analyzeClocks(loadQsysTwoClockGraph());
    expect(analysis.domains.map((d) => [d.name, d.hz])).toEqual([
      ['clk_in', 100e6],
      ['clk', 50e6],
    ]);
    expect(analysis.domainOfPin('/', instancePin('/mst', 'clk'))).toBe(analysis.domains[0]);
    expect(analysis.domainOfPin('/', instancePin('/slv', 'clk'))).toBe(analysis.domains[1]);
  });

  it('follows the clock into a subsystem through its clock pin', () => {
    const analysis = analyzeClocks(loadQsysSubsystemGraph());
    expect(analysis.domains.map((d) => [d.name, d.hz, d.levels])).toEqual([['clk', 25e6, 2]]);
    const [domain] = analysis.domains;
    expect(analysis.domainOfPin('/', instancePin('/sub_0', 'clk'))).toBe(domain);
    expect(analysis.domainOfPin('/sub_0', boundaryPin('clk'))).toBe(domain);
    expect(analysis.domainOfPin('/sub_0', instancePin('/sub_0/mem', 'clk1'))).toBe(domain);
    expect(analysis.instanceDomains('/sub_0')).toEqual([domain]);
  });

  it('has no frequency rule for other clock blocks', () => {
    const analysis = analyzeClocks(loadQsysTclFixtureGraph());
    expect(analysis.domains.length).toBeGreaterThan(0);
    expect(analysis.domains.every((d) => d.hz === undefined)).toBe(true);
  });
});

describe('the plain zynq fixture', () => {
  it('has one domain across three levels', () => {
    const analysis = analyzeClocks(loadFixtureGraph());
    expect(analysis.domains).toHaveLength(1);
    expect(analysis.domains[0]).toMatchObject({ name: 'FCLK_CLK0', hz: 100e6, levels: 3 });
  });

  it('is empty for a graph without clock nets', () => {
    const graph: SystemGraph = { ...loadFixtureGraph(), nets: [] };
    const analysis = analyzeClocks(graph);
    expect(analysis.domains).toEqual([]);
    expect(analysis.resets).toEqual([]);
    expect(analysis.crossings.every((crossing) => crossing.kind === 'block')).toBe(true);
  });
});
