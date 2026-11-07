import type { SystemGraph } from '../../../../domain/systemGraph';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import { DOMAIN_COLORS } from '../../../../webview/systemDiagram/clocks/clockDomains';
import type { CrossingEnd, PinCrossing } from '../../../../webview/systemDiagram/clocks/clockTypes';
import {
  crossingKind,
  crossingProblem,
  crossingProvenance,
  crossingsHeadline,
  crossingSource,
  listedCrossings,
} from '../../../../webview/systemDiagram/clocks/crossingRows';
import {
  crossingCountText,
  levelDomains,
  plural,
  toolbarSummary,
} from '../../../../webview/systemDiagram/clocks/crossingSummary';
import { domainBadge, outlineDomains } from '../../../../webview/systemDiagram/clocks/domainView';
import { instanceClocks } from '../../../../webview/systemDiagram/clocks/instanceClocks';
import { categoryLabel, domainLegend } from '../../../../webview/systemDiagram/legend';
import {
  loadClockFixtureGraph,
  loadFixtureGraph,
  loadQsysFixtureGraph,
  loadVersalClockGraph,
} from './fixtureGraph';

const DSP = '/dsp_pipeline';
const graph = loadClockFixtureGraph();
const analysis = analyzeClocks(graph);

describe('crossing count text', () => {
  it('names only the kinds that are present', () => {
    expect(crossingCountText(2, 1)).toBe('2 CDC · 1 RDC');
    expect(crossingCountText(0, 3)).toBe('3 RDC');
    expect(crossingCountText(4, 0)).toBe('4 CDC');
    expect(crossingCountText(0, 0)).toBe('');
  });

  it('pluralizes by the amount', () => {
    expect(plural(1, 'reset', 'resets')).toBe('1 reset');
    expect(plural(2, 'reset', 'resets')).toBe('2 resets');
    expect(plural(0, 'reset', 'resets')).toBe('0 resets');
  });
});

describe('domainBadge', () => {
  it('counts the crossings on a node, flagged', () => {
    const segments = [{ id: 'clock:0', name: 'a', color: 'red' }];
    expect(domainBadge({ segments, cdc: 2, rdc: 1 })).toEqual({
      text: '2 CDC · 1 RDC',
      warning: true,
      label: '2 clock domain crossings and 1 reset domain crossing',
    });
    expect(domainBadge({ segments, cdc: 0, rdc: 3 })).toMatchObject({
      text: '3 RDC',
      warning: true,
    });
  });

  it('says how many domains a node spans when nothing is flagged', () => {
    const two = [
      { id: 'clock:0', name: 'a', color: 'red' },
      { id: 'clock:1', name: 'b', color: 'blue' },
    ];
    expect(domainBadge({ segments: two, cdc: 0, rdc: 0 })).toEqual({
      text: '2 DOMAINS',
      warning: false,
      label: 'Clocks on 2 domains: a, b',
    });
    expect(domainBadge({ segments: two.slice(0, 1), cdc: 0, rdc: 0 })).toBeUndefined();
    expect(domainBadge({ segments: [], cdc: 0, rdc: 0 })).toBeUndefined();
  });
});

describe('outlineDomains', () => {
  it('gives a leaf block one dot per domain and the names and frequencies as title', () => {
    expect(outlineDomains(analysis, graph, `${DSP}/axis_data_fifo_0`)).toEqual({
      colors: [DOMAIN_COLORS[1], DOMAIN_COLORS[2]],
      title: 'FCLK_CLK0 100 MHz, FCLK_CLK1 200 MHz',
      crossings: 0,
    });
  });

  it('lists the names alone as title when no frequency is set', () => {
    const versal = loadVersalClockGraph();
    expect(outlineDomains(analyzeClocks(versal), versal, '/stream_src').title).toBe('clk_out1');
    const wizard = outlineDomains(analyzeClocks(versal), versal, '/clk_wizard_0');
    expect(wizard.title).toBe('pl0_ref_clk');
  });

  it('counts the flagged crossings inside a hierarchy block only', () => {
    expect(outlineDomains(analysis, graph, DSP).crossings).toBe(4);
    expect(outlineDomains(analysis, graph, `${DSP}/fir_compiler_0`).crossings).toBe(0);
  });
});

describe('toolbarSummary', () => {
  it('shows the flagged crossings of each kind', () => {
    expect(toolbarSummary(analysis)).toEqual({ text: '2 CDC · 2 RDC', warning: true });
  });

  it('shows the number of domains when nothing is flagged', () => {
    expect(toolbarSummary(analyzeClocks(loadFixtureGraph()))).toEqual({
      text: '1',
      warning: false,
    });
    expect(toolbarSummary(analyzeClocks(loadQsysFixtureGraph())).warning).toBe(false);
  });

  it('names only the kind that is flagged', () => {
    const fewer = { ...analysis, crossings: analysis.crossings.filter((c) => c.kind !== 'reset') };
    expect(toolbarSummary(fewer).text).toBe('2 CDC');
  });
});

describe('levelDomains', () => {
  it('lists the domains with a pin on the level, in domain order', () => {
    expect(levelDomains(analysis, graph, '/').map((domain) => domain.name)).toEqual([
      'ext_clk',
      'FCLK_CLK0',
      'FCLK_CLK1',
    ]);
    expect(levelDomains(analysis, graph, DSP).map((domain) => domain.name)).toEqual([
      'FCLK_CLK0',
      'FCLK_CLK1',
    ]);
  });
});

describe('legend', () => {
  it('names a domain with its frequency, then the reset and crossing marks', () => {
    const entries = domainLegend(analysis.domains.slice(1, 3));
    expect(entries.map((entry) => entry.label)).toEqual([
      'FCLK_CLK0 · 100 MHz',
      'FCLK_CLK1 · 200 MHz',
      'Reset, colored by the domain that releases it',
      'Clock or reset domain crossing',
    ]);
    expect(entries[0]).toMatchObject({ color: DOMAIN_COLORS[1] });
    expect(entries[0].line).toBeUndefined();
    expect(entries.slice(2).map((entry) => entry.line)).toEqual(['dotted', 'dashed']);
  });

  it('names a domain without a frequency alone', () => {
    const [clk0] = analysis.domains.slice(1, 2).map((domain) => ({ ...domain, hz: undefined }));
    expect(domainLegend([clk0])[0].label).toBe('FCLK_CLK0');
  });

  it('keeps the reset and crossing marks without domains', () => {
    expect(domainLegend([]).map((entry) => entry.key)).toEqual(['reset', 'crossing']);
  });

  it('labels a net category as the legend does', () => {
    expect(categoryLabel('axis')).toBe('AXI4-Stream');
    expect(categoryLabel('aximm')).toBe('AXI memory-mapped');
  });
});

describe('instanceClocks', () => {
  const rows = (path: string) => instanceClocks(graph, analysis, graph.instances[path]);

  it('lists the clock pins with their domain and net', () => {
    const dma = rows('/axi_dma_0');
    expect(dma.clockPins.map((row) => [row.pin, row.domain?.name])).toEqual([
      ['s_axi_lite_aclk', 'FCLK_CLK0'],
      ['m_axi_mm2s_aclk', 'FCLK_CLK0'],
      ['m_axi_s2mm_aclk', 'FCLK_CLK0'],
    ]);
    expect(dma.clockPins[0].netId).toBe('/::processing_system7_0_FCLK_CLK0');
  });

  it('knows the clock of an interface of a block with one clock domain, by its source', () => {
    const dma = rows('/axi_dma_0');
    const mm2s = dma.interfaces.find((row) => row.pin === 'M_AXIS_MM2S')!;
    expect(mm2s.knownFrom).toBe('all clocks one domain');
    expect(mm2s.domain?.name).toBe('FCLK_CLK0');
    expect(mm2s.clockPin).toBeUndefined();
    expect(dma.hasUnchecked).toBe(false);
  });

  it('does not know the clock of an interface of a block on two domains', () => {
    const fifo = rows(`${DSP}/axis_data_fifo_0`);
    expect(fifo.interfaces.map((row) => [row.pin, row.knownFrom])).toEqual([
      ['S_AXIS', undefined],
      ['M_AXIS', undefined],
    ]);
    expect(fifo.hasUnchecked).toBe(true);
  });

  it('lists the domains of a leaf block that spans two or more, and none otherwise', () => {
    expect(rows(`${DSP}/axis_data_fifo_0`).spannedDomains.map((domain) => domain.name)).toEqual([
      'FCLK_CLK0',
      'FCLK_CLK1',
    ]);
    expect(rows('/axi_dma_0').spannedDomains).toEqual([]);
    // A hierarchy block on two domains is no block that "uses" them.
    expect(rows(DSP).spannedDomains).toEqual([]);
  });

  it('takes the only clock of a block as the clock of its interfaces', () => {
    const fir = rows(`${DSP}/fir_compiler_0`);
    expect(
      fir.interfaces.every((row) => row.clockPin === 'aclk' && row.knownFrom === 'single clock')
    ).toBe(true);
  });

  it('lists the reset inputs with their source and check, never the reset output itself', () => {
    const fir = rows(`${DSP}/fir_compiler_0`);
    expect(fir.resets).toHaveLength(1);
    expect(fir.resets[0]).toMatchObject({
      pin: 'aresetn',
      source: { label: 'rst_ps7_0_100M/peripheral_aresetn' },
    });
    expect(fir.resets[0].check?.tone).toBe('warning');
    const reset = rows('/rst_ps7_0_100M');
    expect(reset.resets.map((row) => row.pin)).toEqual(['ext_reset_in']);
    expect(reset.resets[0].check).toMatchObject({ tone: 'ok', text: '✓ asynchronous input' });
  });

  it('lists only the clock pins of a hierarchy block', () => {
    const hier = rows(DSP);
    expect(hier.clockPins.map((row) => [row.pin, row.domain?.name])).toEqual([
      ['aclk', 'FCLK_CLK0'],
      ['dsp_clk', 'FCLK_CLK1'],
    ]);
    expect(hier.interfaces).toEqual([]);
    expect(hier.resets).toEqual([]);
  });

  it('is empty for a block without a clock', () => {
    const none = JSON.parse(JSON.stringify(graph)) as SystemGraph;
    none.instances['/axi_dma_0'].pins = [];
    expect(
      instanceClocks(none, analyzeClocks(none), none.instances['/axi_dma_0']).clockPins
    ).toEqual([]);
  });

  it('checks an expected frequency of the definition against the domain', () => {
    const edited = JSON.parse(JSON.stringify(graph)) as SystemGraph;
    const pins = edited.instances[`${DSP}/fir_compiler_0`].pins;
    pins.find((pin) => pin.name === 'aclk')!.frequency = '200MHz';
    const ok = instanceClocks(
      edited,
      analyzeClocks(edited),
      edited.instances[`${DSP}/fir_compiler_0`]
    );
    expect(ok.clockPins[0].expected?.status).toBe('match');
    pins.find((pin) => pin.name === 'aclk')!.frequency = '100MHz';
    const bad = instanceClocks(
      edited,
      analyzeClocks(edited),
      edited.instances[`${DSP}/fir_compiler_0`]
    );
    expect(bad.clockPins[0].expected?.status).toBe('mismatch');
  });
});

describe('crossing rows', () => {
  const findPin = (predicate: (crossing: PinCrossing) => boolean) =>
    analysis.crossings.find(
      (crossing): crossing is PinCrossing => crossing.kind !== 'block' && predicate(crossing)
    )!;
  const cdc = findPin((crossing) => crossing.kind === 'data' && crossing.status === 'cross');
  const rdc = findPin((crossing) => crossing.kind === 'reset' && crossing.status === 'cross');
  const unchecked = findPin((crossing) => crossing.status === 'unchecked');
  const withoutFrequency = (end: CrossingEnd): CrossingEnd => ({
    ...end,
    domain: end.domain && { ...end.domain, hz: undefined },
  });

  it('lists the crossings without a synchronizer, and the unchecked ones when asked for', () => {
    const flagged = listedCrossings(analysis.crossings, false);
    expect(flagged).toHaveLength(4);
    expect(flagged.every((crossing) => crossing.status === 'cross')).toBe(true);
    const all = listedCrossings(analysis.crossings, true);
    expect(all.map((crossing) => crossing.status)).toEqual([
      'cross',
      'cross',
      'cross',
      'cross',
      'unchecked',
      'unchecked',
      'unchecked',
    ]);
  });

  it('never lists a block, related, or ok row', () => {
    const versal = analyzeClocks(loadVersalClockGraph());
    expect(versal.crossings.some((crossing) => crossing.status === 'related')).toBe(true);
    expect(listedCrossings(versal.crossings, true)).toEqual([]);
    expect(analysis.crossings.some((crossing) => crossing.kind === 'block')).toBe(true);
    expect(
      listedCrossings(analysis.crossings, true).some((crossing) =>
        ['inside', 'related', 'ok'].includes(crossing.status)
      )
    ).toBe(false);
  });

  it('counts the crossings in one line: none, one, or many', () => {
    expect(crossingsHeadline(0)).toBe('No clock domain crossings on this level.');
    expect(crossingsHeadline(1)).toBe('1 crossing without a synchronizer.');
    expect(crossingsHeadline(4)).toBe('4 crossings without a synchronizer.');
  });

  it('names the kind: the interface type, or reset', () => {
    expect(crossingKind(cdc)).toBe('AXI4-Stream');
    expect(crossingKind(rdc)).toBe('Reset');
    expect(crossingKind({ ...cdc, category: undefined })).toBe('Data');
  });

  describe('problem text', () => {
    it('gives both frequencies of a data crossing when they are known', () => {
      expect(crossingProblem(cdc)).toBe('200 MHz to 100 MHz, no synchronizer');
    });

    it('gives the domains of a data crossing when a frequency is not known', () => {
      expect(crossingProblem({ ...cdc, from: withoutFrequency(cdc.from) })).toBe(
        'FCLK_CLK1 to FCLK_CLK0 · 100 MHz, no synchronizer'
      );
      const bare = { ...cdc, from: withoutFrequency(cdc.from), to: withoutFrequency(cdc.to) };
      expect(crossingProblem(bare)).toBe('FCLK_CLK1 to FCLK_CLK0, no synchronizer');
    });

    it('gives the domains of a data crossing when both are on the same frequency', () => {
      const sameHz = (end: CrossingEnd, hz: number): CrossingEnd => ({
        ...end,
        domain: end.domain && { ...end.domain, hz },
      });
      const alike = { ...cdc, from: sameHz(cdc.from, 100e6), to: sameHz(cdc.to, 100e6) };
      expect(crossingProblem(alike)).toBe(
        'FCLK_CLK1 · 100 MHz to FCLK_CLK0 · 100 MHz, no synchronizer'
      );
    });

    it('names the releasing domain and the sink domain of a reset', () => {
      expect(crossingProblem(rdc)).toBe(
        'released by FCLK_CLK0 · 100 MHz, clocked by FCLK_CLK1 · 200 MHz'
      );
      expect(crossingProblem({ ...rdc, from: withoutFrequency(rdc.from) })).toBe(
        'released by FCLK_CLK0, clocked by FCLK_CLK1 · 200 MHz'
      );
    });

    it('says an asynchronous reset is, instead of a releasing domain', () => {
      const asynchronous = { ...rdc, from: { ...rdc.from, async: true } };
      expect(crossingProblem(asynchronous)).toBe(
        'asynchronous reset, clocked by FCLK_CLK1 · 200 MHz'
      );
    });

    it('gives the reason of a crossing that was not checked', () => {
      expect(crossingProblem(unchecked)).toBe(unchecked.reason);
      expect(crossingProblem(unchecked)).toMatch(/has clocks on 2 domains/);
    });

    it('never says unknown', () => {
      for (const crossing of listedCrossings(analysis.crossings, true)) {
        expect(crossingProblem(crossing)).not.toMatch(/unknown/i);
      }
    });
  });

  describe('provenance tooltip', () => {
    it('tells how the clock of each end of a data crossing was determined', () => {
      expect(crossingProvenance(cdc)).toBe(
        'fir_compiler_0/M_AXIS_DATA: FCLK_CLK1 · 200 MHz, known from single clock\n' +
          'axi_dma_0/S_AXIS_S2MM: FCLK_CLK0 · 100 MHz, known from all clocks one domain'
      );
    });

    it('tells which rule releases a reset, and how the sink clock is known', () => {
      expect(crossingProvenance(rdc)).toBe(
        'rst_ps7_0_100M/peripheral_aresetn: FCLK_CLK0 · 100 MHz, known from proc_sys_reset slowest_sync_clk\n' +
          `${rdc.to.label}: FCLK_CLK1 · 200 MHz, known from single clock`
      );
    });

    it('says an asynchronous end is, and when a clock or a source is not known', () => {
      const asynchronous = crossingProvenance({
        ...rdc,
        from: { ...rdc.from, async: true, knownFrom: undefined },
      });
      expect(asynchronous.split('\n')[0]).toBe('rst_ps7_0_100M/peripheral_aresetn: asynchronous');
      expect(crossingProvenance(unchecked)).toMatch(/axis_data_fifo_0\/\w+: clock not known/);
      const sourceUnknown = { ...rdc.from, domain: undefined, sourceUnknown: true as const };
      expect(crossingProvenance({ ...rdc, from: sourceUnknown })).toMatch(
        /^rst_ps7_0_100M\/peripheral_aresetn: source not known, known from /
      );
    });
  });

  it('opens the net of a crossing in its script', () => {
    expect(crossingSource(graph, cdc)).toMatchObject({
      source: { fileName: 'zynq_clock_domains.tcl' },
    });
    expect(crossingSource(graph, cdc)?.line).toBeGreaterThan(0);
  });
});
