/** @jest-environment node */
// Runs the whole render path in a Node environment (no jsdom): it never touches the DOM.
jest.mock('@xyflow/react', () => {
  throw new Error('React must not load on the render path');
});
jest.mock('react', () => {
  throw new Error('React must not load on the render path');
});

import { DOMParser } from '@xmldom/xmldom';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runCliRender, type CliRenderArgs } from '../../../cli/render';
import { devResourceRoots } from '../../../services/ResourceRoots';
import { FONT_FILES } from '../../../shared/render/fontFaces';
import { readSystemDesign } from '../../../services/systemDiagram/readSystemDesign';
import { measureText, plexTextMeasure } from '../../../shared/render/textMetrics';
import { buildElkInput, toFlowElements } from '../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../webview/systemDiagram/layout/runElkLayout';

const repoRoot = path.resolve(__dirname, '../../../..');
const fixtures = path.join(repoRoot, 'src/test/fixtures/system-design');
const ZYNQ = path.join(fixtures, 'zynq_dma_system.tcl');
const QSYS = path.join(fixtures, 'nios_avalon_system.qsys');

let tmp: string;
let fontsDir: string;
let roots: ReturnType<typeof devResourceRoots>;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-render-'));
  fontsDir = path.join(tmp, 'fonts');
  fs.mkdirSync(fontsDir);
  const source = (name: string) =>
    path.join(
      repoRoot,
      'node_modules/@fontsource',
      name.startsWith('ibm-plex-mono') ? 'ibm-plex-mono' : 'ibm-plex-sans',
      'files',
      name
    );
  for (const file of Object.values(FONT_FILES)) {
    fs.copyFileSync(source(file), path.join(fontsDir, file));
  }
  roots = { ...devResourceRoots(repoRoot), fontsDir };
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function args(input: string, name: string, extra: Partial<CliRenderArgs> = {}): CliRenderArgs {
  return {
    inputPath: input,
    out: path.join(tmp, name),
    level: '/',
    expand: [],
    select: [],
    highlight: [],
    clocks: false,
    theme: 'light',
    grid: true,
    legend: true,
    background: 'editor',
    scale: 2,
    quality: 90,
    ...extra,
  };
}

async function render(input: string, name: string, extra: Partial<CliRenderArgs> = {}) {
  const result = await runCliRender(args(input, name, extra), roots);
  expect(result.error).toBeUndefined();
  expect(result.success).toBe(true);
  return fs.readFileSync(result.outputPath, 'utf8');
}

async function laidOutNodeCount(input: string, expanded: string[] = []): Promise<number> {
  const graph = readSystemDesign(input, path.basename(input), fs.readFileSync(input, 'utf8'))!;
  const layout = await runElkLayout(
    buildElkInput(graph, '/', { measure: plexTextMeasure, expanded: new Set(expanded) })
  );
  return toFlowElements(layout, graph, '/', plexTextMeasure).nodes.length;
}

function parse(svg: string) {
  const errors: string[] = [];
  const doc = new DOMParser({ onError: (_level, message) => errors.push(message) }).parseFromString(
    svg,
    'image/svg+xml'
  );
  expect(errors).toEqual([]);
  return doc;
}

describe('runCliRender', () => {
  it.each([
    ['zynq_dma_system.tcl', ZYNQ],
    ['nios_avalon_system.qsys', QSYS],
  ])('writes a standalone SVG for %s', async (name, input) => {
    const svg = await render(input, `${name}.svg`);
    const doc = parse(svg);
    expect(doc.documentElement?.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(svg).not.toContain('foreignObject');
    expect(svg).not.toContain('var(');
    expect(svg).not.toContain('class=');
    expect(doc.getElementsByTagName('g').length).toBeGreaterThan(0);
    const blocks = Array.from(doc.getElementsByTagName('g')).filter((g) =>
      g.hasAttribute('data-node')
    );
    expect(blocks).toHaveLength(await laidOutNodeCount(input));
    expect(svg).toContain("font-family:'IBM Plex Sans'");
  });

  it('draws every subtitle inside its block, ellipsized when it does not fit', async () => {
    const doc = parse(await render(QSYS, 'subtitles.svg'));
    for (const g of Array.from(doc.getElementsByTagName('g'))) {
      if (g.getAttribute('data-kind') !== 'instance') {
        continue;
      }
      const width = Number(g.getElementsByTagName('rect')[0].getAttribute('width')) + 1;
      const subtitle = Array.from(g.getElementsByTagName('text')).find(
        (t) => t.getAttribute('font-size') === '10.5'
      );
      const text = subtitle?.textContent ?? '';
      // Left inset 9 px, right inset 8 px: the measured text must end inside the inner header.
      expect(9 + measureText(text, 'mono400', 10.5)).toBeLessThanOrEqual(width - 8 + 1e-6);
    }
  });

  it('sets unhinted text rendering, so Chrome does not round glyph advances to whole pixels', async () => {
    expect(await render(QSYS, 'hinting.svg')).toContain('text-rendering:geometricPrecision');
  });

  it('renders the same bytes twice', async () => {
    const first = await render(ZYNQ, 'a.svg');
    const second = await render(ZYNQ, 'b.svg');
    expect(second).toBe(first);
  });

  it('uses another palette for --theme dark', async () => {
    const light = await render(ZYNQ, 'light.svg');
    const dark = await render(ZYNQ, 'dark.svg', { theme: 'dark' });
    expect(dark).not.toBe(light);
    expect(dark).toContain('#1f1f1f');
    expect(light).not.toContain('#1f1f1f');
  });

  it('honours --no-grid, --no-legend and --background transparent', async () => {
    const full = await render(ZYNQ, 'full.svg');
    expect(full).toContain('ipcraft-grid');
    expect(full).toContain('data-legend');
    expect(await render(ZYNQ, 'nogrid.svg', { grid: false })).not.toContain('ipcraft-grid');
    expect(await render(ZYNQ, 'nolegend.svg', { legend: false })).not.toContain('data-legend');
    const transparent = await render(ZYNQ, 'transparent.svg', { background: 'transparent' });
    expect(transparent).not.toContain('fill="#ffffff"');
    expect(full).toContain('fill="#ffffff"');
  });

  it('draws a frame for --expand', async () => {
    const collapsed = parse(await render(ZYNQ, 'collapsed.svg'));
    const svg = await render(ZYNQ, 'expanded.svg', { expand: ['/dsp_pipeline'] });
    const doc = parse(svg);
    const kinds = (d: ReturnType<typeof parse>) =>
      Array.from(d.getElementsByTagName('g')).map((g) => g.getAttribute('data-kind'));
    expect(kinds(collapsed)).not.toContain('frame');
    expect(kinds(doc)).toContain('frame');
    expect(kinds(doc).filter((kind) => kind !== null)).toHaveLength(
      await laidOutNodeCount(ZYNQ, ['/dsp_pipeline'])
    );
  });

  it('accepts a hierarchy block by name', async () => {
    const byName = await render(ZYNQ, 'byname.svg', { expand: ['dsp_pipeline'] });
    expect(byName).toBe(await render(ZYNQ, 'bypath.svg', { expand: ['/dsp_pipeline'] }));
  });

  it('fails on an unknown level with suggestions', async () => {
    const result = await runCliRender(args(ZYNQ, 'x.svg', { level: '/dsp' }), roots);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown level '/dsp'");
    expect(result.error).toContain('/dsp_pipeline');
    expect(fs.existsSync(path.join(tmp, 'x.svg'))).toBe(false);
  });

  it('fails on an unknown or non-hierarchy --expand with suggestions', async () => {
    const unknown = await runCliRender(args(ZYNQ, 'x.svg', { expand: ['/dsp_pipelin'] }), {
      ...roots,
    });
    expect(unknown.success).toBe(false);
    expect(unknown.error).toContain('Closest: /dsp_pipeline');
    const notHier = await runCliRender(args(ZYNQ, 'x.svg', { expand: ['/axi_dma_0'] }), {
      ...roots,
    });
    expect(notHier.success).toBe(false);
    expect(notHier.error).toContain('is not a hierarchy block');
  });

  it('rejects files that are not system designs or IP cores', async () => {
    const other = path.join(tmp, 'notes.tcl');
    fs.writeFileSync(other, 'puts hello\n');
    const otherResult = await runCliRender(args(other, 'x.svg'), roots);
    expect(otherResult.error).toContain('not a recognized system design');
  });

  it('accepts a nested hierarchy block when its parent is expanded, in any order', async () => {
    const nested = ['/dsp_pipeline', '/dsp_pipeline/coeff_bank'];
    const svg = await render(ZYNQ, 'nested.svg', { expand: nested });
    expect(await render(ZYNQ, 'nested2.svg', { expand: [...nested].reverse() })).toBe(svg);
    const frames = Array.from(parse(svg).getElementsByTagName('g')).filter(
      (g) => g.getAttribute('data-kind') === 'frame'
    );
    expect(frames).toHaveLength(2);
    const groups = Array.from(parse(svg).getElementsByTagName('g')).filter((g) =>
      g.hasAttribute('data-node')
    );
    expect(groups).toHaveLength(await laidOutNodeCount(ZYNQ, nested));
  });

  it('rejects a nested block whose parent is not expanded, with suggestions', async () => {
    const result = await runCliRender(
      args(ZYNQ, 'x.svg', { expand: ['/dsp_pipeline/coeff_bank'] }),
      roots
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('inside an expanded block');
    expect(result.error).toContain('/dsp_pipeline');
  });

  it('rejects a bare --expand name shared by several blocks, but accepts their paths', async () => {
    const soc = path.join(fixtures, 'generated', 'vivado_dsp_soc_8ch.tcl');
    const ambiguous = await runCliRender(args(soc, 'x.svg', { expand: ['/ch0', '/ch1', 'dsp'] }), {
      ...roots,
    });
    expect(ambiguous.success).toBe(false);
    expect(ambiguous.error).toContain("ambiguous name 'dsp', use the path: /ch0/dsp, /ch1/dsp");
    const byPath = await runCliRender(
      args(soc, 'x.svg', { expand: ['/ch0', '/ch1', '/ch0/dsp'] }),
      roots
    );
    expect(byPath.error).toBeUndefined();
  });

  it('names a missing input file plainly', async () => {
    const result = await runCliRender(args(path.join(tmp, 'absent.tcl'), 'x.svg'), roots);
    expect(result.success).toBe(false);
    expect(result.error).toBe(`Input file not found: ${path.join(tmp, 'absent.tcl')}`);
  });

  it('names a missing font file', async () => {
    const empty = fs.mkdtempSync(path.join(tmp, 'nofonts-'));
    const result = await runCliRender(args(ZYNQ, 'x.svg'), { ...roots, fontsDir: empty });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Font file not found:');
    expect(result.error).toContain(FONT_FILES.sans400);
  });
});
