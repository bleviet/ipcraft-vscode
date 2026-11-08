/** @jest-environment node */
// `ipcraft render` selection, highlight and clock decorations (issue #268, step 4).
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
import { parseArgs } from '../../../cli/argv';
import { devResourceRoots } from '../../../services/ResourceRoots';
import { FONT_FILES } from '../../../shared/render/fontFaces';
import { paletteFor } from '../../../shared/render/palette';
import { readSystemDesign } from '../../../services/systemDiagram/readSystemDesign';
import { hopDistances, isolationSubset, maxRadius } from '../../../webview/systemDiagram/isolation';
import { boundaryId } from '../../../webview/systemDiagram/model';

const repoRoot = path.resolve(__dirname, '../../../..');
const fixtures = path.join(repoRoot, 'src/test/fixtures/system-design');
const ZYNQ = path.join(fixtures, 'zynq_dma_system.tcl');
const CLOCKS = path.join(fixtures, 'zynq_clock_domains.tcl');

let tmp: string;
let roots: ReturnType<typeof devResourceRoots>;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-select-'));
  const fontsDir = path.join(tmp, 'fonts');
  fs.mkdirSync(fontsDir);
  for (const file of Object.values(FONT_FILES)) {
    const family = file.startsWith('ibm-plex-mono') ? 'ibm-plex-mono' : 'ibm-plex-sans';
    fs.copyFileSync(
      path.join(repoRoot, 'node_modules/@fontsource', family, 'files', file),
      path.join(fontsDir, file)
    );
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
  return fs.readFileSync(result.outputPath, 'utf8');
}

async function failure(input: string, extra: Partial<CliRenderArgs>) {
  const result = await runCliRender(args(input, 'x.svg', extra), roots);
  expect(result.success).toBe(false);
  return result.error as string;
}

function groups(svg: string) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  return Array.from(doc.getElementsByTagName('g')).filter((g) => g.hasAttribute('data-node'));
}

const nodeIds = (svg: string) => groups(svg).map((g) => g.getAttribute('data-node'));
const graphOf = (file: string) =>
  readSystemDesign(file, path.basename(file), fs.readFileSync(file, 'utf8'))!;

describe('--select and --hops', () => {
  it.each([1, 2])('draws the %i-hop isolation of the viewer', async (hops) => {
    const graph = graphOf(ZYNQ);
    const subset = isolationSubset(graph, '/', ['/axi_dma_0'], hops);
    const svg = await render(ZYNQ, `h${hops}.svg`, { select: ['axi_dma_0'], hops });
    expect(nodeIds(svg).sort()).toEqual([...subset.nodeIds].sort());
    expect(nodeIds(svg).length).toBeLessThan(nodeIds(await render(ZYNQ, 'full.svg')).length);
    const selected = groups(svg).filter((g) => g.getAttribute('data-selected') === 'true');
    expect(selected.map((g) => g.getAttribute('data-node'))).toEqual(['/axi_dma_0']);
  });

  it('defaults to one hop and clamps --hops to the reach of the selection', async () => {
    const graph = graphOf(ZYNQ);
    const reach = maxRadius(hopDistances(graph, '/', ['/axi_dma_0']));
    const one = await render(ZYNQ, 'one.svg', { select: ['axi_dma_0'] });
    expect(one).toBe(await render(ZYNQ, 'one2.svg', { select: ['axi_dma_0'], hops: 1 }));
    const far = await render(ZYNQ, 'far.svg', { select: ['axi_dma_0'], hops: reach + 5 });
    expect(far).toBe(await render(ZYNQ, 'reach.svg', { select: ['axi_dma_0'], hops: reach }));
  });

  it('selects an external port with port:<name>, and by instance path', async () => {
    const graph = graphOf(ZYNQ);
    const port = graph.levels['/'].boundaryPins[0].name;
    const svg = await render(ZYNQ, 'port.svg', { select: [`port:${port}`] });
    expect(
      groups(svg)
        .find((g) => g.getAttribute('data-selected'))
        ?.getAttribute('data-node')
    ).toBe(boundaryId('/', port));
    expect(await render(ZYNQ, 'path.svg', { select: ['/axi_dma_0'] })).toBe(
      await render(ZYNQ, 'name.svg', { select: ['axi_dma_0'] })
    );
  });

  it('fails on an unknown name with the closest names', async () => {
    const error = await failure(ZYNQ, { select: ['axi_dma'] });
    expect(error).toContain("'axi_dma' in --select");
    expect(error).toContain('/axi_dma_0');
    expect(await failure(ZYNQ, { select: ['port:nope'] })).toContain('Closest: port:');
  });
});

describe('--highlight', () => {
  it('marks exactly the named blocks without isolating', async () => {
    const full = await render(ZYNQ, 'full.svg');
    const svg = await render(ZYNQ, 'hl.svg', { highlight: ['axi_dma_0', 'port:pl_irq'] });
    expect(nodeIds(svg)).toEqual(nodeIds(full));
    const marked = groups(svg)
      .filter((g) => g.getAttribute('data-selected') === 'true')
      .map((g) => g.getAttribute('data-node'));
    expect(marked.sort()).toEqual(['/::pl_irq', '/axi_dma_0']);
    expect(svg).toContain(paletteFor('light').focusBorder);
  });

  it('must be in the isolated view when combined with --select', async () => {
    const ok = await render(ZYNQ, 'both.svg', {
      select: ['axi_dma_0'],
      highlight: ['axi_mem_intercon'],
    });
    expect(groups(ok).filter((g) => g.getAttribute('data-selected'))).toHaveLength(2);
    const error = await failure(ZYNQ, { select: ['axi_dma_0'], highlight: ['axi_gpio_0'] });
    expect(error).toContain("'axi_gpio_0' in --highlight is not in the isolated view");
    expect(await failure(ZYNQ, { highlight: ['nope'] })).toContain("'nope' in --highlight");
  });
});

describe('--select and --highlight with --expand', () => {
  const INNER = '/dsp_pipeline/fir_compiler_0';

  it('isolates the level and draws a selected expanded block as a frame', async () => {
    const svg = await render(ZYNQ, 'sel-exp.svg', {
      select: ['axi_dma_0'],
      expand: ['/dsp_pipeline'],
    });
    const kinds = groups(svg).map((g) => g.getAttribute('data-kind'));
    expect(kinds).toContain('frame');
    expect(nodeIds(svg)).not.toContain('/axi_gpio_0');
    expect(nodeIds(svg)).toContain(INNER);
    expect(svg).not.toBe(await render(ZYNQ, 'sel-noexp.svg', { select: ['axi_dma_0'] }));
  });

  it('highlights an instance inside an expanded block, but not one the isolation hides', async () => {
    const svg = await render(ZYNQ, 'hl-inner.svg', {
      expand: ['/dsp_pipeline'],
      highlight: [INNER],
    });
    const marked = groups(svg).filter((g) => g.getAttribute('data-selected') === 'true');
    expect(marked.map((g) => g.getAttribute('data-node'))).toEqual([INNER]);
    const error = await failure(ZYNQ, {
      expand: ['/dsp_pipeline'],
      select: ['axi_gpio_0'],
      highlight: [INNER],
    });
    expect(error).toContain('is not in the isolated view');
    expect(await failure(ZYNQ, { highlight: ['fir_compiler_0'] })).toContain(
      'or inside an expanded block'
    );
  });
});

describe('--clocks', () => {
  it('draws domain colors, a dashed crossing wire, dimmed wires and the domain legend', async () => {
    const palette = paletteFor('light');
    const svg = await render(CLOCKS, 'clocks.svg', { clocks: true });
    expect(svg).not.toContain('var(');
    expect(svg).toContain(`fill="${palette.tokens['--vscode-charts-purple']}"`);
    expect(svg).toMatch(new RegExp(`stroke="${palette.warning}"[^>]*stroke-dasharray="6 4"`));
    expect(svg).toContain('opacity="0.2"');
    expect(svg).toContain('Clock domain crossing');
    expect(svg).toContain('FCLK_CLK0');
    expect(svg).toContain('100 MHz');
    expect(svg).toContain(' CDC');
    expect(svg).not.toEqual(await render(CLOCKS, 'plain.svg'));
  });

  it('is deterministic and works for the dark palette', async () => {
    const a = await render(CLOCKS, 'a.svg', { clocks: true, theme: 'dark' });
    expect(await render(CLOCKS, 'b.svg', { clocks: true, theme: 'dark' })).toBe(a);
    expect(a).toContain(paletteFor('dark').warning);
  });

  it('renders a PNG of --clocks with --select', async () => {
    const result = await runCliRender(
      args(CLOCKS, 'both.png', { clocks: true, select: ['axi_dma_0'] }),
      roots
    );
    expect(result.error).toBeUndefined();
    const png = fs.readFileSync(result.outputPath);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });
});

describe('argument parsing', () => {
  const parse = (...rest: string[]) => parseArgs(['render', 'a.tcl', '--out', 'a.svg', ...rest]);

  it('parses repeatable and comma-separated lists, --hops and --clocks', () => {
    expect(
      parse('--select', 'a,b', '--select', 'port:c', '--hops', '3', '--highlight', 'd', '--clocks')
    ).toEqual({
      kind: 'render',
      args: expect.objectContaining({
        select: ['a', 'b', 'port:c'],
        hops: 3,
        highlight: ['d'],
        clocks: true,
      }),
    });
  });

  it.each([
    [['--hops', '2'], '--hops needs --select'],
    [['--select', 'a', '--hops', '0'], "Invalid --hops '0'"],
    [['--select', 'a', '--hops', 'x'], "Invalid --hops 'x'"],
    [['--select', ','], 'Missing value for --select'],
  ])('rejects %j', (rest, message) => {
    expect(parse(...rest)).toEqual({ kind: 'error', message: expect.stringContaining(message) });
  });

  it.each([['--select', 'a'], ['--hops', '2'], ['--highlight', 'a'], ['--clocks']])(
    'rejects %s for an .ip.yml',
    (...option) => {
      expect(parseArgs(['render', 'c.ip.yml', '--out', 'c.svg', ...option])).toEqual({
        kind: 'error',
        message: `Option '${option[0]}' is only for system designs, not for an .ip.yml`,
      });
    }
  );
});
