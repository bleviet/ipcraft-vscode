import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import type { PinCrossing } from '../../../../webview/systemDiagram/clocks/clockTypes';
import {
  clocksInView,
  crossingsInView,
  domainsInView,
  resetsInView,
} from '../../../../webview/systemDiagram/clocks/viewScope';
import { shownLevels } from '../../../../webview/systemDiagram/expansion';
import { loadClockFixtureGraph } from './fixtureGraph';

const DSP = '/dsp_pipeline';
const graph = loadClockFixtureGraph();
const analysis = analyzeClocks(graph);

const view = (levelPath: string, expanded: string[] = []) =>
  clocksInView(graph, analysis, shownLevels(graph, levelPath, new Set(expanded)));
const flagged = (levelPath: string, expanded: string[] = []) =>
  view(levelPath, expanded)
    .crossings.filter((crossing) => crossing.status === 'cross')
    .map((crossing) => `${crossing.from.label} > ${crossing.to.label}`);
const unchecked = (levelPath: string, expanded: string[] = []) =>
  view(levelPath, expanded).crossings.filter((crossing) => crossing.status === 'unchecked');

describe('what the Clocks tab shows for the view on screen', () => {
  describe('at the root, with dsp_pipeline collapsed', () => {
    it('lists the crossings with an end on the root, and none inside the block', () => {
      expect(flagged('/')).toEqual([
        // The data crossing from inside dsp_pipeline to axi_dma_0 has an end on the root.
        'fir_compiler_0/M_AXIS_DATA > axi_dma_0/S_AXIS_S2MM',
        // A reset released on the root, with sinks inside the block.
        'rst_ps7_0_100M/peripheral_aresetn > fir_compiler_0/aresetn',
        'rst_ps7_0_100M/peripheral_aresetn > ovf_monitor_0/rst_n',
      ]);
      // fir_ctrl_0 > fir_compiler_0 is entirely inside dsp_pipeline.
      expect(unchecked('/')).toHaveLength(2);
    });

    it('lists the domains and resets that have a pin on the root', () => {
      expect(view('/').domains.map((domain) => domain.name)).toEqual([
        'ext_clk',
        'FCLK_CLK0',
        'FCLK_CLK1',
      ]);
      expect(view('/').resets).toHaveLength(3);
    });
  });

  describe('inside dsp_pipeline', () => {
    it('lists every crossing that has an end in the block', () => {
      expect(flagged(DSP)).toHaveLength(4);
      expect(flagged(DSP)).toContain('fir_ctrl_0/M_AXIS_CONFIG > fir_compiler_0/S_AXIS_CONFIG');
      expect(unchecked(DSP)).toHaveLength(3);
    });

    it('lists the domains with a pin in the block, not one used only on the root', () => {
      expect(view(DSP).domains.map((domain) => domain.name)).toEqual(['FCLK_CLK0', 'FCLK_CLK1']);
    });

    it('lists the reset with a sink in the block, not a reset with a source and sinks on the root', () => {
      expect(view(DSP).resets.map((reset) => reset.label)).toEqual([
        'rst_ps7_0_100M/peripheral_aresetn',
      ]);
    });
  });

  describe('at the root with dsp_pipeline expanded', () => {
    it('adds the crossings inside the block to those of the root', () => {
      expect(flagged('/', [DSP])).toHaveLength(4);
      expect(flagged('/', [DSP])).toContain(
        'fir_ctrl_0/M_AXIS_CONFIG > fir_compiler_0/S_AXIS_CONFIG'
      );
      expect(unchecked('/', [DSP])).toHaveLength(3);
    });

    it('shows the domains and resets of the root and of the block', () => {
      expect(view('/', [DSP]).domains).toHaveLength(3);
      expect(view('/', [DSP]).resets).toHaveLength(3);
    });
  });

  describe('a crossing inside a collapsed nested hierarchy', () => {
    const [cross] = analysis.crossings.filter(
      (crossing): crossing is PinCrossing =>
        crossing.kind !== 'block' && crossing.status === 'cross'
    );
    const inner = '/dsp_pipeline/inner';
    const nested: PinCrossing = {
      ...cross,
      from: { ...cross.from, level: inner },
      to: { ...cross.to, level: inner },
    };

    it('is not listed on the root, in the block that holds it, or with only the block expanded', () => {
      for (const levels of [['/'], [DSP], ['/', DSP]]) {
        expect(crossingsInView([nested], new Set(levels))).toEqual([]);
      }
    });

    it('is listed once the nested level is in view', () => {
      expect(crossingsInView([nested], new Set(['/', DSP, inner]))).toEqual([nested]);
      expect(crossingsInView([nested], new Set([inner]))).toEqual([nested]);
    });

    it('is listed when only one of its ends is in view', () => {
      const leaving: PinCrossing = { ...nested, to: { ...nested.to, level: '/' } };
      expect(crossingsInView([leaving], new Set(['/']))).toEqual([leaving]);
      expect(crossingsInView([leaving], new Set([inner]))).toEqual([leaving]);
      expect(crossingsInView([leaving], new Set([DSP]))).toEqual([]);
    });
  });

  it('lists no block record, and keeps the order of the crossings', () => {
    const pins = analysis.crossings.filter((crossing) => crossing.kind !== 'block');
    expect(pins.length).toBeLessThan(analysis.crossings.length);
    expect(crossingsInView(analysis.crossings, new Set(['/', DSP]))).toEqual(pins);
  });

  it('lists nothing when no level is in view', () => {
    const none = new Set<string>();
    expect(crossingsInView(analysis.crossings, none)).toEqual([]);
    expect(domainsInView(graph, analysis.domains, none)).toEqual([]);
    expect(resetsInView(analysis.resets, none)).toEqual([]);
  });
});
