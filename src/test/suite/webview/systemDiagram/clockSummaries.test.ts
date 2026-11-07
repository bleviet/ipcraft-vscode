import type { SystemGraph } from '../../../../domain/systemGraph';
import { analyzeClocks } from '../../../../webview/systemDiagram/clocks/analyzeClocks';
import { DOMAIN_COLORS } from '../../../../webview/systemDiagram/clocks/clockDomains';
import type { Crossing } from '../../../../webview/systemDiagram/clocks/clockTypes';
import {
  asynchronousText,
  coverageNote,
  crossingBlockLabel,
  crossingKind,
  crossingKnownFrom,
  crossingSource,
  CROSSING_STATUSES,
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

describe('crossing rows of related clocks', () => {
  it('give the reason where the known-from texts would be', () => {
    const versal = loadVersalClockGraph();
    const related = analyzeClocks(versal).crossings.find(
      (crossing) => crossing.status === 'related'
    )!;
    expect(crossingKnownFrom(related)).toEqual({ reason: related.reason, sources: [] });
    expect(crossingKnownFrom(related).reason).toMatch(/^Both clocks come from clk_wizard_0/);
  });
});

describe('crossing rows', () => {
  const find = (predicate: (crossing: Crossing) => boolean) => analysis.crossings.find(predicate)!;
  const cdc = find((crossing) => crossing.kind === 'data' && crossing.status === 'cross');
  const rdc = find((crossing) => crossing.kind === 'reset' && crossing.status === 'cross');
  const block = find((crossing) => crossing.kind === 'block');
  const unchecked = find((crossing) => crossing.status === 'unchecked');
  const asyncReset = find((crossing) => crossing.kind === 'reset' && crossing.from.async === true);

  it('lists the statuses in order with their icons', () => {
    expect(CROSSING_STATUSES.map((entry) => entry.status)).toEqual([
      'cross',
      'related',
      'inside',
      'unchecked',
      'ok',
    ]);
    expect(CROSSING_STATUSES.map((entry) => entry.icon)).toEqual(['!', '≈', '⇄', '?', '✓']);
  });

  it('names the kind: the interface type, reset, or block', () => {
    expect(crossingKind(cdc)).toBe('AXI4-Stream');
    expect(crossingKind(rdc)).toBe('Reset');
    expect(crossingKind(block)).toBe('Block');
  });

  it('replaces the domain of an asynchronous end', () => {
    if (asyncReset.kind !== 'reset') {
      throw new Error('expected a reset crossing');
    }
    expect(asynchronousText(asyncReset.from, 'from')).toBe('asynchronous');
    expect(asynchronousText(asyncReset.to, 'to')).toBe('asynchronous input');
    if (cdc.kind === 'data') {
      expect(asynchronousText(cdc.from, 'from')).toBeUndefined();
    }
  });

  it('tells where the clocks are known from, or why they are not', () => {
    expect(crossingKnownFrom(cdc)).toEqual({ sources: ['single clock', 'all clocks one domain'] });
    expect(crossingKnownFrom(unchecked).reason).toMatch(/has clocks on 2 domains/);
    expect(crossingKnownFrom(block).reason).toMatch(/review that it synchronizes/);
  });

  it('opens the net of a crossing and the block of a block record', () => {
    expect(crossingSource(graph, cdc)).toMatchObject({
      source: { fileName: 'zynq_clock_domains.tcl' },
    });
    expect(crossingSource(graph, cdc)?.line).toBeGreaterThan(0);
    expect(crossingSource(graph, block)?.line).toBe(
      graph.instances[`${DSP}/axis_data_fifo_0`].line
    );
  });

  it('names a block with its level', () => {
    expect(crossingBlockLabel(graph, block)).toBe('axis_data_fifo_0 (dsp_pipeline)');
    expect(crossingBlockLabel(graph, cdc)).toBe('');
  });

  it('adds to the coverage note that Platform Designer synchronizes by itself', () => {
    expect(coverageNote(graph)).toMatch(/^Checked: memory-mapped and streaming connections/);
    expect(coverageNote(graph)).not.toMatch(/Platform Designer/);
    expect(coverageNote(loadQsysFixtureGraph())).toMatch(
      /Platform Designer inserts clock-crossing adapters/
    );
  });
});
