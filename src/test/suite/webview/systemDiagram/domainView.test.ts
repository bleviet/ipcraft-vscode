import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import { DOMAIN_COLORS } from '../../../../webview/systemDiagram/clocks/clockDomains';
import {
  nodeDomains,
  pinDomainColor,
  pinFrequencyLabel,
  UNRELEASED_RESET_COLOR,
} from '../../../../webview/systemDiagram/clocks/domainView';
import { loadClockFixtureGraph } from './fixtureGraph';

const DSP = '/dsp_pipeline';
const at = (instance: string | null, pin: string) => ({ instance, pin });

describe('domain view helpers', () => {
  const graph = loadClockFixtureGraph();
  const analysis = analyzeClocks(graph);

  it('colors a clock pin with its domain and a reset pin with the releasing domain', () => {
    expect(pinDomainColor(analysis, '/', at('/axi_dma_0', 's_axi_lite_aclk'))).toBe(
      DOMAIN_COLORS[1]
    );
    expect(pinDomainColor(analysis, DSP, at(null, 'dsp_clk'))).toBe(DOMAIN_COLORS[2]);
    expect(pinDomainColor(analysis, '/', at('/axi_dma_0', 'axi_resetn'))).toBe(DOMAIN_COLORS[1]);
    expect(pinDomainColor(analysis, DSP, at(`${DSP}/fir_compiler_0`, 'aresetn'))).toBe(
      DOMAIN_COLORS[1]
    );
  });

  it('mutes an asynchronous or unknown reset and leaves other pins uncolored', () => {
    expect(pinDomainColor(analysis, '/', at('/rst_ps7_0_100M', 'ext_reset_in'))).toBe(
      UNRELEASED_RESET_COLOR
    );
    expect(pinDomainColor(analysis, '/', at('/axi_dma_0', 'S_AXIS_S2MM'))).toBeUndefined();
    expect(pinDomainColor(analysis, '/', at('/axi_dma_0', 'M_AXI_MM2S'))).toBeUndefined();
  });

  it('labels a clock pin with its frequency, `unknown` without one', () => {
    expect(pinFrequencyLabel(analysis, DSP, at(`${DSP}/fir_compiler_0`, 'aclk'))).toBe('200 MHz');
    expect(pinFrequencyLabel(analysis, '/', at(null, 'ext_clk'))).toBe('125 MHz');
    expect(pinFrequencyLabel(analysis, '/', at('/axi_dma_0', 'S_AXIS_S2MM'))).toBeUndefined();
    const unknown = loadClockFixtureGraph();
    delete unknown.instances['/processing_system7_0'].parameters[
      'CONFIG.PCW_FPGA1_PERIPHERAL_FREQMHZ'
    ];
    expect(
      pinFrequencyLabel(analyzeClocks(unknown), DSP, at(`${DSP}/fir_compiler_0`, 'aclk'))
    ).toBe('unknown');
  });

  it('gives a node one strip segment per domain and its crossing counts', () => {
    expect(nodeDomains(analysis, graph, `${DSP}/fir_compiler_0`)).toEqual({
      segments: [{ id: 'clock:2', name: 'FCLK_CLK1', color: DOMAIN_COLORS[2] }],
      cdc: 2,
      rdc: 1,
    });
    expect(nodeDomains(analysis, graph, `${DSP}/axis_data_fifo_0`)).toEqual({
      segments: [
        { id: 'clock:1', name: 'FCLK_CLK0', color: DOMAIN_COLORS[1] },
        { id: 'clock:2', name: 'FCLK_CLK1', color: DOMAIN_COLORS[2] },
      ],
      cdc: 0,
      rdc: 0,
    });
    expect(nodeDomains(analysis, graph, DSP)).toMatchObject({ cdc: 2, rdc: 2 });
    expect(nodeDomains(analysis, graph, '/::ext_clk')).toEqual({ segments: [], cdc: 0, rdc: 0 });
  });
});
