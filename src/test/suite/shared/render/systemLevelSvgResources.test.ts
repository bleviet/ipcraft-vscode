import { paletteFor } from '../../../../shared/render/palette';
import { STRIP_GAP, STRIP_HEIGHT } from '../../../../shared/render/resourceSvg';
import {
  renderSystemLevelSvg,
  type SystemLevelLayout,
  type SystemLevelOptions,
} from '../../../../shared/render/systemLevelSvg';
import { plexTextMeasure } from '../../../../shared/render/textMetrics';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';
import { vivadoGraph, vivadoReport } from '../../webview/systemDiagram/resources/resourceReports';

const COUNTS = '154 LUT · 168 FF · 0 BRAM · 0 DSP';
const SHARES = '18.3 % design · 0.2 % device';
/** The strip of a block with a share: the counts and the shares. */
const STRIP_LINES = 2;
const TALL = STRIP_GAP + STRIP_LINES * STRIP_HEIGHT;
const MARGIN = 24;

describe('renderSystemLevelSvg resources', () => {
  let layout: SystemLevelLayout;

  beforeAll(async () => {
    layout = toFlowElements(
      await runElkLayout(buildElkInput(vivadoGraph, '/', { measure: plexTextMeasure })),
      vivadoGraph,
      '/',
      plexTextMeasure
    );
  }, 30000);

  const draw = (theme: 'light' | 'dark', extra: Partial<SystemLevelOptions> = {}, plain = layout) =>
    renderSystemLevelSvg(plain, {
      palette: paletteFor(theme),
      grid: false,
      legend: false,
      background: 'transparent',
      fontFaceCss: '',
      ...extra,
    });
  const group = (svg: string, id: string) =>
    new RegExp(`<g [^>]*data-node="${id}"[^>]*>(.*?)</g>`).exec(svg)![1];
  const viewBox = (svg: string) => /viewBox="([^"]*)"/.exec(svg)![1].split(' ').map(Number);

  it('draws the strip of figures above a block in two lines, left aligned, in the mono face at the pin label size', () => {
    const svg = draw('light', { resources: { report: vivadoReport } });
    const own = group(svg, '/axi_bram_ctrl_0');
    const texts = [...own.matchAll(/<text[^>]*>[^<]*<\/text>/g)].map((match) => match[0]);
    // The counts on top, the shares below, one text each.
    const counts = texts.findIndex((text) => text.includes(`>${COUNTS}</text>`));
    const shares = texts.findIndex((text) => text.includes(`>${SHARES}</text>`));
    expect(counts).toBeGreaterThanOrEqual(0);
    expect(shares).toBe(counts + 1);
    for (const text of [texts[counts], texts[shares]]) {
      expect(text).toContain('font-size="11"');
      expect(text).toContain(`font-family="'IBM Plex Mono'`);
      expect(text).toMatch(/ x="4"/);
    }
    const y = (text: string) => Number(/ y="([-\d.]+)"/.exec(text)![1]);
    expect(y(texts[shares]) - y(texts[counts])).toBe(STRIP_HEIGHT);
    // One translucent background over both lines ends STRIP_GAP above the block, clear of its border.
    expect(own.match(/fill-opacity="0.8"/g)).toHaveLength(1);
    expect(own).toMatch(
      new RegExp(
        `<rect x="0" y="-${TALL}"[^>]*height="${STRIP_LINES * STRIP_HEIGHT}"[^>]*fill-opacity="0.8"`
      )
    );
  });

  it('draws a one line strip, with the one line background, where the block has no shares', () => {
    const none = {
      ...vivadoReport,
      instances: { '/axi_bram_ctrl_0': { total: [154, 168, 0, 0, 0, 0, 0] } },
      design: { total: [0, 0, 0, 0, 0, 0, 0] },
      metrics: vivadoReport.metrics.map(({ capacity: _capacity, ...metric }) => metric),
      notInReport: ['/smartconnect_0'],
    };
    const own = group(draw('light', { resources: { report: none } }), '/axi_bram_ctrl_0');
    expect(own).toContain(`>${COUNTS}</text>`);
    expect(own).not.toContain('design');
    expect(own).toMatch(
      new RegExp(`<rect x="0" y="-${STRIP_GAP + STRIP_HEIGHT}"[^>]*height="${STRIP_HEIGHT}"`)
    );
    const missing = group(draw('light', { resources: { report: none } }), '/smartconnect_0');
    expect(missing).toContain('>not in report</text>');
    expect(missing).toMatch(
      new RegExp(`<rect x="0" y="-${STRIP_GAP + STRIP_HEIGHT}"[^>]*height="${STRIP_HEIGHT}"`)
    );
  });

  it('grows the image to hold the strips: the view box starts above the top strip', () => {
    const plain = draw('light');
    const svg = draw('light', { resources: { report: vivadoReport } });
    const top = Math.min(
      ...layout.nodes
        .filter((node) => vivadoReport.instances[node.id])
        .map((node) => node.position.y)
    );
    expect(viewBox(svg)[1]).toBeLessThanOrEqual(Math.floor(top - TALL - MARGIN));
    expect(viewBox(svg)[1]).toBeLessThanOrEqual(viewBox(plain)[1]);
    expect(viewBox(svg)[3]).toBeGreaterThanOrEqual(viewBox(plain)[3]);
  });

  it('grows a crop to the strips of the blocks it holds', () => {
    const ids = new Set(['/axi_bram_ctrl_0']);
    const block = layout.nodes.find((node) => node.id === '/axi_bram_ctrl_0')!;
    const svg = draw('light', { resources: { report: vivadoReport }, cropNodeIds: ids });
    expect(viewBox(svg)[1]).toBeLessThanOrEqual(Math.floor(block.position.y - TALL - MARGIN));
    expect(svg).toContain(`>${COUNTS}</text>`);
  });

  it('draws the same bytes without resources as before, and with a report that names no block', () => {
    const plain = draw('dark');
    expect(draw('dark', { resources: undefined })).toBe(plain);
    expect(plain).not.toContain('LUT');
    expect(
      draw('dark', { resources: { report: { ...vivadoReport, instances: {}, notInReport: [] } } })
    ).toBe(plain);
  });

  it('draws no strip on the ghost of a removed block', () => {
    const svg = draw('light', {
      resources: { report: vivadoReport },
      changes: {
        nodes: new Map([['/smartconnect_0', { status: 'removed' as const }]]),
        newEdgeIds: new Set<string>(),
        legend: { kinds: [], newWire: false, removed: 0 },
      },
    });
    const own = group(svg, '/smartconnect_0');
    expect(own).not.toContain('LUT');
    expect(group(svg, '/axi_bram_ctrl_0')).toContain(COUNTS);
  });
});
