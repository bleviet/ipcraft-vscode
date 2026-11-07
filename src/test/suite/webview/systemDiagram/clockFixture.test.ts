import { isClockOrReset } from '../../../../webview/systemDiagram/model';
import { loadClockFixtureGraph } from './fixtureGraph';

describe('zynq_clock_domains.tcl', () => {
  const graph = loadClockFixtureGraph();
  const net = (id: string) => graph.nets.find((candidate) => candidate.id === id)!;

  it('reads the root and the dsp_pipeline hierarchy', () => {
    expect(Object.keys(graph.levels)).toEqual(['/', '/dsp_pipeline']);
    expect(graph.name).toBe('zynq_clock_domains');
    expect(graph.levels['/dsp_pipeline'].instances).toEqual([
      '/dsp_pipeline/axis_data_fifo_0',
      '/dsp_pipeline/fir_ctrl_0',
      '/dsp_pipeline/fir_compiler_0',
      '/dsp_pipeline/ovf_monitor_0',
    ]);
    expect(graph.instances['/dsp_pipeline/ovf_monitor_0']).toMatchObject({
      kind: 'module',
      moduleRef: 'ovf_monitor',
    });
  });

  it('declares the hierarchy pins, clocks and reset by type', () => {
    const pins = graph.levels['/dsp_pipeline'].boundaryPins;
    expect(pins.map((pin) => [pin.name, pin.signalType ?? pin.vlnv?.split(':')[2]])).toEqual([
      ['S_AXIS', 'axis_rtl'],
      ['S_AXI_CTRL', 'aximm_rtl'],
      ['M_AXIS', 'axis_rtl'],
      ['aclk', 'clk'],
      ['dsp_clk', 'clk'],
      ['aresetn', 'rst'],
    ]);
  });

  it('keeps the script values the rules read', () => {
    expect(graph.instances['/processing_system7_0'].parameters).toMatchObject({
      'CONFIG.PCW_FPGA0_PERIPHERAL_FREQMHZ': '100',
      'CONFIG.PCW_EN_CLK1_PORT': '1',
      'CONFIG.PCW_FPGA1_PERIPHERAL_FREQMHZ': '200',
    });
    expect(graph.instances['/dsp_pipeline/axis_data_fifo_0'].parameters).toMatchObject({
      'CONFIG.IS_ACLK_ASYNC': '1',
    });
    const port = graph.levels['/'].boundaryPins.find((pin) => pin.name === 'ext_clk');
    expect(port?.parameters).toEqual({
      'CONFIG.ASSOCIATED_BUSIF': 'S_AXIS_EXT',
      'CONFIG.ASSOCIATED_RESET': 'ext_resetn',
      'CONFIG.FREQ_HZ': '125000000',
    });
  });

  it('classifies the clock and reset nets of both levels', () => {
    const categories = (level: string) =>
      graph.nets
        .filter((candidate) => candidate.level === level && isClockOrReset(candidate))
        .map((candidate) => [candidate.name, candidate.category]);
    expect(categories('/')).toEqual([
      ['ext_clk_1', 'clock'],
      ['ext_resetn_1', 'reset'],
      ['processing_system7_0_FCLK_CLK0', 'clock'],
      ['processing_system7_0_FCLK_CLK1', 'clock'],
      ['processing_system7_0_FCLK_RESET0_N', 'reset'],
      ['rst_ps7_0_100M_peripheral_aresetn', 'reset'],
    ]);
    expect(categories('/dsp_pipeline')).toEqual([
      ['aclk_1', 'clock'],
      ['aresetn_1', 'reset'],
      ['dsp_clk_1', 'clock'],
    ]);
  });

  it('connects the clocks and resets through the hierarchy pins', () => {
    const endpoints = (id: string) =>
      net(id).endpoints.map((ref) => `${ref.instance ?? ''}::${ref.pin}`);
    expect(endpoints('/::processing_system7_0_FCLK_CLK1')).toEqual([
      '/processing_system7_0::FCLK_CLK1',
      '/dsp_pipeline::dsp_clk',
    ]);
    expect(endpoints('/dsp_pipeline::dsp_clk_1')).toEqual([
      '::dsp_clk',
      '/dsp_pipeline/axis_data_fifo_0::m_axis_aclk',
      '/dsp_pipeline/fir_compiler_0::aclk',
      '/dsp_pipeline/ovf_monitor_0::clk',
    ]);
    expect(endpoints('/dsp_pipeline::aresetn_1')).toEqual([
      '::aresetn',
      '/dsp_pipeline/axis_data_fifo_0::s_axis_aresetn',
      '/dsp_pipeline/fir_ctrl_0::rst_n',
      '/dsp_pipeline/fir_compiler_0::aresetn',
      '/dsp_pipeline/ovf_monitor_0::rst_n',
    ]);
  });

  it('connects the stream path from the DMA through the hierarchy and back', () => {
    const hasPins = (id: string, ...pins: string[]) => {
      const found = net(id).endpoints.map((ref) => `${ref.instance ?? ''}::${ref.pin}`);
      return pins.every((pin) => found.includes(pin));
    };
    expect(
      hasPins('/::axi_dma_0_M_AXIS_MM2S', '/axi_dma_0::M_AXIS_MM2S', '/dsp_pipeline::S_AXIS')
    ).toBe(true);
    expect(
      hasPins('/dsp_pipeline::Conn1', '::S_AXIS', '/dsp_pipeline/axis_data_fifo_0::S_AXIS')
    ).toBe(true);
    expect(
      hasPins('/dsp_pipeline::axis_data_fifo_0_M_AXIS', '/dsp_pipeline/fir_compiler_0::S_AXIS_DATA')
    ).toBe(true);
    expect(
      hasPins('/dsp_pipeline::Conn2', '::M_AXIS', '/dsp_pipeline/fir_compiler_0::M_AXIS_DATA')
    ).toBe(true);
    expect(
      hasPins('/::dsp_pipeline_M_AXIS', '/axi_dma_0::S_AXIS_S2MM', '/dsp_pipeline::M_AXIS')
    ).toBe(true);
    expect(net('/dsp_pipeline::Conn2').category).toBe('axis');
  });

  it('has no parse problems beyond the skipped Vivado-only commands', () => {
    expect(graph.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning')).toEqual([]);
  });
});
