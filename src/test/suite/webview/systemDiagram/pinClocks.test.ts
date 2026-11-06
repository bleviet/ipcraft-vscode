import type { SystemGraph, SystemPin } from '../../../../domain/systemGraph';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import { loadClockFixtureGraph } from './fixtureGraph';

const DSP = '/dsp_pipeline';
const FIFO = `${DSP}/axis_data_fifo_0`;
const FIR = `${DSP}/fir_compiler_0`;
const CTRL = `${DSP}/fir_ctrl_0`;
const at = (instance: string | null, pin: string) => ({ instance, pin });

function pinOf(graph: SystemGraph, instance: string, name: string): SystemPin {
  return graph.instances[instance].pins.find((pin) => pin.name === name)!;
}

describe('the clock of an interface pin', () => {
  const analysis = analyzeClocks(loadClockFixtureGraph());
  const clock = (instance: string, pin: string) => analysis.clockOfPin(DSP, at(instance, pin));
  const domainName = (instance: string, pin: string) => clock(instance, pin)?.domain?.name;

  it('is the only clock of the block', () => {
    expect(clock(CTRL, 'S_AXI')).toMatchObject({ clockPin: 'clk', knownFrom: 'single clock' });
    expect(domainName(CTRL, 'S_AXI')).toBe('FCLK_CLK0');
    expect(domainName(FIR, 'S_AXIS_DATA')).toBe('FCLK_CLK1');
  });

  it('is the domain all the clocks of the block share, whichever clock it uses', () => {
    const dma = analysis.clockOfPin('/', at('/axi_dma_0', 'S_AXIS_S2MM'));
    expect(dma).toMatchObject({ knownFrom: 'all clocks one domain' });
    expect(dma?.clockPin).toBeUndefined();
    expect(dma?.domain?.name).toBe('FCLK_CLK0');
  });

  it('is unknown on a block with clocks on two domains, and not guessed from names', () => {
    // S_AXIS / s_axis_aclk and M_AXIS / m_axis_aclk look paired; that is not used.
    expect(clock(FIFO, 'S_AXIS')).toBeUndefined();
    expect(clock(FIFO, 'M_AXIS')).toBeUndefined();
    expect(analysis.unknownClockReason(DSP, at(FIFO, 'S_AXIS'))).toBe(
      'axis_data_fifo_0 has clocks on 2 domains; the clock of S_AXIS is in its definition'
    );
  });

  it('is unknown for hierarchy pins, missing pins and level-inside boundary pins', () => {
    expect(analysis.clockOfPin('/', at(DSP, 'S_AXIS'))).toBeUndefined();
    expect(analysis.clockOfPin(DSP, at(null, 'S_AXIS'))).toBeUndefined();
    expect(analysis.clockOfPin(DSP, at(FIR, 'nope'))).toBeUndefined();
    expect(analysis.clockOfPin('/', at('/nope', 'x'))).toBeUndefined();
  });
});

describe('the clock of a pin from the definition', () => {
  function withDefinition(): SystemGraph {
    const graph = loadClockFixtureGraph();
    pinOf(graph, FIFO, 'S_AXIS').associatedClock = 's_axis_aclk';
    pinOf(graph, FIFO, 'S_AXIS').definedBy = 'ip.yml';
    pinOf(graph, FIFO, 'M_AXIS').associatedClock = 'm_axis_aclk';
    pinOf(graph, FIFO, 's_axis_aresetn').associatedClock = 's_axis_aclk';
    return graph;
  }

  it('uses associatedClock, known from the ip.yml or else from the definition', () => {
    const analysis = analyzeClocks(withDefinition());
    expect(analysis.clockOfPin(DSP, at(FIFO, 'S_AXIS'))).toMatchObject({
      clockPin: 's_axis_aclk',
      knownFrom: 'ip.yml',
      domain: { name: 'FCLK_CLK0' },
    });
    expect(analysis.clockOfPin(DSP, at(FIFO, 'M_AXIS'))).toMatchObject({
      clockPin: 'm_axis_aclk',
      knownFrom: 'definition',
      domain: { name: 'FCLK_CLK1' },
    });
    expect(analysis.clockOfPin(DSP, at(FIFO, 's_axis_aresetn'))?.domain?.name).toBe('FCLK_CLK0');
  });

  it('matches the clock pin name case-insensitively, like the definition match', () => {
    const graph = withDefinition();
    pinOf(graph, FIFO, 'M_AXIS').associatedClock = 'M_AXIS_ACLK';
    const clock = analyzeClocks(graph).clockOfPin(DSP, at(FIFO, 'M_AXIS'));
    expect(clock).toMatchObject({ clockPin: 'm_axis_aclk', domain: { name: 'FCLK_CLK1' } });
  });

  it('beats the single-clock rule and reports a clock pin that is not connected', () => {
    const graph = loadClockFixtureGraph();
    pinOf(graph, CTRL, 'S_AXI').associatedClock = 'aux_clk';
    const analysis = analyzeClocks(graph);
    const clock = analysis.clockOfPin(DSP, at(CTRL, 'S_AXI'));
    expect(clock).toEqual({ clockPin: 'aux_clk', domain: undefined, knownFrom: 'definition' });
    expect(analysis.unknownClockReason(DSP, at(CTRL, 'S_AXI'))).toBe(
      'clock pin aux_clk of fir_ctrl_0 is not connected'
    );
  });
});

describe('the clock of a root external port', () => {
  const analysis = analyzeClocks(loadClockFixtureGraph());

  it('is the clock port that lists it in CONFIG.ASSOCIATED_BUSIF or CONFIG.ASSOCIATED_RESET', () => {
    expect(analysis.clockOfPin('/', at(null, 'S_AXIS_EXT'))).toMatchObject({
      clockPin: 'ext_clk',
      knownFrom: 'CONFIG.ASSOCIATED_BUSIF',
      domain: { name: 'ext_clk' },
    });
    expect(analysis.clockOfPin('/', at(null, 'ext_resetn'))).toMatchObject({
      clockPin: 'ext_clk',
      knownFrom: 'CONFIG.ASSOCIATED_RESET',
      domain: { name: 'ext_clk' },
    });
  });

  it('is unknown when no clock port lists it', () => {
    const graph = loadClockFixtureGraph();
    const port = graph.levels['/'].boundaryPins.find((pin) => pin.name === 'ext_clk')!;
    port.parameters['CONFIG.ASSOCIATED_BUSIF'] = 'OTHER_PORT:ANOTHER';
    delete port.parameters['CONFIG.ASSOCIATED_RESET'];
    const result = analyzeClocks(graph);
    expect(result.clockOfPin('/', at(null, 'S_AXIS_EXT'))).toBeUndefined();
    expect(result.unknownClockReason('/', at(null, 'S_AXIS_EXT'))).toBe(
      'external port S_AXIS_EXT is not listed in CONFIG.ASSOCIATED_BUSIF of a clock port'
    );
    expect(result.unknownClockReason('/', at(null, 'ext_resetn'))).toBe(
      'external port ext_resetn is not listed in CONFIG.ASSOCIATED_RESET of a clock port'
    );
  });

  it('splits the colon-separated list', () => {
    const graph = loadClockFixtureGraph();
    const port = graph.levels['/'].boundaryPins.find((pin) => pin.name === 'ext_clk')!;
    port.parameters['CONFIG.ASSOCIATED_BUSIF'] = 'M_AXIS_EXT: S_AXIS_EXT';
    expect(analyzeClocks(graph).clockOfPin('/', at(null, 'S_AXIS_EXT'))?.domain?.name).toBe(
      'ext_clk'
    );
  });

  it('reports a listed clock port that has no net', () => {
    const graph = loadClockFixtureGraph();
    graph.nets = graph.nets.filter((net) => net.id !== '/::ext_clk_1');
    const result = analyzeClocks(graph);
    expect(result.clockOfPin('/', at(null, 'S_AXIS_EXT'))).toMatchObject({
      clockPin: 'ext_clk',
      domain: undefined,
    });
    expect(result.unknownClockReason('/', at(null, 'S_AXIS_EXT'))).toBe(
      'clock port ext_clk is not connected'
    );
  });

  it('does not apply to the boundary pins of a hierarchy', () => {
    expect(analysis.clockOfPin(DSP, at(null, 'S_AXIS'))).toBeUndefined();
  });
});

describe('unknownClockReason', () => {
  it('says so when a block has no clock with a known domain', () => {
    const graph = loadClockFixtureGraph();
    graph.instances['/lone'] = {
      path: '/lone',
      name: 'lone',
      parent: '/',
      kind: 'ip',
      parameters: {},
      pins: [
        {
          name: 'S',
          isInterface: true,
          direction: 'slave',
          directionSource: 'declared',
          parameters: {},
        },
      ],
      line: 1,
    };
    expect(analyzeClocks(graph).unknownClockReason('/', at('/lone', 'S'))).toBe(
      'lone has no clock with a known domain'
    );
  });
});

describe('expected frequency of a clock pin', () => {
  function expectation(frequency: string | undefined, mutate?: (graph: SystemGraph) => void) {
    const graph = loadClockFixtureGraph();
    if (frequency !== undefined) {
      pinOf(graph, CTRL, 'clk').frequency = frequency;
    }
    mutate?.(graph);
    return analyzeClocks(graph).expectedFrequency(DSP, at(CTRL, 'clk'));
  }

  it('matches the domain frequency', () => {
    const result = expectation('100MHz');
    expect(result).toMatchObject({ expected: '100MHz', expectedHz: 100e6, status: 'match' });
    expect(result?.domain?.name).toBe('FCLK_CLK0');
    expect(expectation('100 000 000')?.status).toBe('unknown');
    expect(expectation('0.1GHz')?.status).toBe('match');
  });

  it('differs from the domain frequency', () => {
    expect(expectation('200MHz')).toMatchObject({ expectedHz: 200e6, status: 'mismatch' });
  });

  it('is unknown for text that is not a frequency, or a domain without one', () => {
    expect(expectation('fast')).toMatchObject({ expected: 'fast', status: 'unknown' });
    expect(expectation('fast')?.expectedHz).toBeUndefined();
    const noFrequency = expectation('100MHz', (graph) => {
      delete graph.instances['/processing_system7_0'].parameters[
        'CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ'
      ];
    });
    expect(noFrequency).toMatchObject({ expectedHz: 100e6, status: 'unknown' });
  });

  it('is undefined for a pin without an expected frequency', () => {
    expect(expectation(undefined)).toBeUndefined();
  });

  it('has no domain for a pin that is on no clock net', () => {
    const graph = loadClockFixtureGraph();
    pinOf(graph, CTRL, 'rst_n').frequency = '1MHz';
    const reset = analyzeClocks(graph).expectedFrequency(DSP, at(CTRL, 'rst_n'));
    expect(reset).toEqual({ expected: '1MHz', expectedHz: 1e6, status: 'unknown' });
  });
});
