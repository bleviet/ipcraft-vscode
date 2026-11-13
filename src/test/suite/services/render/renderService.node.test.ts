/** @jest-environment node */
// The shared render service (CLI and Export image): crop, and equality with the CLI's output.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { runCliRender, type CliRenderArgs } from '../../../../cli/render';
import { busLibraryFor } from '../../../../cli/renderIpCore';
import { devResourceRoots } from '../../../../services/ResourceRoots';
import {
  parseIpCoreDocument,
  renderIpSymbolImage,
} from '../../../../services/render/ipSymbolImage';
import { RenderAssets } from '../../../../services/render/renderResources';
import { renderSystemLevelImage } from '../../../../services/render/systemLevelImage';
import { readSystemDesign } from '../../../../services/systemDiagram/readSystemDesign';
import { FONT_FILES } from '../../../../shared/render/fontFaces';
import { paletteFor } from '../../../../shared/render/palette';
import { plexTextMeasure } from '../../../../shared/render/textMetrics';
import { buildChangeMarks, type ChangeMarks } from '../../../../webview/systemDiagram/changeMarks';
import { zynqDiff, zynqGraph } from '../../webview/systemDiagram/compareFixtures';
import { nodeBounds } from '../../../../webview/systemDiagram/layout/diagramBounds';
import { buildElkInput, toFlowElements } from '../../../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../../../webview/systemDiagram/layout/runElkLayout';

const repoRoot = path.resolve(__dirname, '../../../../..');
const ZYNQ = path.join(repoRoot, 'src/test/fixtures/system-design/zynq_dma_system.tcl');
const LED = path.join(repoRoot, 'examples/led_avmm/led_controller_avmm.ip.yml');
const MARGIN = 24;

let tmp: string;
let roots: ReturnType<typeof devResourceRoots>;
const assets = new RenderAssets();
const look = { theme: 'light', grid: true, legend: false, background: 'editor' } as const;
const svg = { format: 'svg', scale: 2, quality: 90 } as const;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-render-service-'));
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

beforeEach(() => {
  // BusLibraryService reads the bus definitions through the VS Code file system API.
  (vscode.Uri.file as jest.Mock).mockImplementation((fsPath: string) => ({ fsPath }));
  const workspaceFs = vscode.workspace.fs as unknown as Record<string, jest.Mock>;
  workspaceFs.readDirectory = jest.fn(async (uri: { fsPath: string }) =>
    fs
      .readdirSync(uri.fsPath, { withFileTypes: true })
      .map((entry) => [entry.name, entry.isDirectory() ? 2 : 1])
  );
  workspaceFs.readFile = jest.fn(async (uri: { fsPath: string }) => fs.readFileSync(uri.fsPath));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');
const viewBoxOf = (image: string) =>
  /viewBox="([^"]+)"/.exec(image)![1].split(' ').map(Number) as [number, number, number, number];

function cliArgs(extra: Partial<CliRenderArgs>): CliRenderArgs {
  return {
    inputPath: ZYNQ,
    out: path.join(tmp, 'cli.svg'),
    level: '/',
    expand: [],
    select: [],
    highlight: [],
    clocks: false,
    theme: 'light',
    grid: true,
    legend: false,
    background: 'editor',
    scale: 2,
    quality: 90,
    ...extra,
  };
}

describe('renderSystemLevelImage', () => {
  const graph = readSystemDesign(ZYNQ, 'zynq_dma_system.tcl', fs.readFileSync(ZYNQ, 'utf8'))!;

  it('draws what ipcraft render draws for the same level and options', async () => {
    const selected = graph.levels['/'].instances.slice(0, 2);
    const result = await runCliRender(cliArgs({ select: selected, hops: 2, clocks: true }), roots);
    expect(result.error).toBeUndefined();
    const bytes = await renderSystemLevelImage(
      graph,
      {
        level: '/',
        expanded: [],
        isolate: { nodeIds: selected, hops: 2 },
        selectedNodeIds: selected,
        clocks: true,
      },
      look,
      svg,
      assets,
      roots
    );
    expect(text(bytes)).toBe(fs.readFileSync(result.outputPath, 'utf8'));
  });

  it('crops to the union of the named nodes plus the margin', async () => {
    const ids = graph.levels['/'].instances.slice(1, 3);
    const laidOut = await runElkLayout(buildElkInput(graph, '/', { measure: plexTextMeasure }));
    const boxes = toFlowElements(laidOut, graph, '/', plexTextMeasure)
      .nodes.filter((node) => ids.includes(node.id))
      .map(nodeBounds);
    const x = Math.min(...boxes.map((box) => box.x));
    const y = Math.min(...boxes.map((box) => box.y));
    const width = Math.max(...boxes.map((box) => box.x + box.width)) - x;
    const height = Math.max(...boxes.map((box) => box.y + box.height)) - y;

    const bytes = await renderSystemLevelImage(
      graph,
      { level: '/', expanded: [], selectedNodeIds: [], clocks: false, cropNodeIds: ids },
      look,
      svg,
      assets,
      roots
    );
    expect(viewBoxOf(text(bytes))).toEqual([
      Math.floor(x - MARGIN),
      Math.floor(y - MARGIN),
      Math.ceil(width + 2 * MARGIN),
      Math.ceil(height + 2 * MARGIN),
    ]);
  });

  it('draws the marks of a comparison on the nodes and wires of the current revision', async () => {
    const current = zynqGraph('current');
    const request = { level: '/', expanded: [], selectedNodeIds: [], clocks: false } as const;
    const draw = async (changes?: ChangeMarks) =>
      text(
        await renderSystemLevelImage(
          current,
          { ...request, changes },
          { ...look, legend: true },
          svg,
          assets,
          roots
        )
      );
    const plain = await draw();
    const marked = await draw(buildChangeMarks(zynqDiff(), current));
    const { added, changed } = paletteFor('light').change;
    const body = (image: string, id: string) =>
      new RegExp(`<g [^>]*data-node="${id}"[^>]*>(.*?)</g>`).exec(image)![1];
    expect(plain).not.toContain(added);
    // axis_data_fifo_0 is new, sys_ps7 has a changed parameter, gpio_block has a change inside.
    expect(body(marked, '/axis_data_fifo_0')).toContain(`stroke="${added}"`);
    expect(body(marked, '/axis_data_fifo_0')).toContain('>+</text>');
    expect(body(marked, '/sys_ps7')).toContain(`stroke="${changed}"`);
    expect(body(marked, '/gpio_block')).toContain('>~ 1 inside</text>');
    expect(body(marked, '/sync_0')).toBe(body(plain, '/sync_0'));
    expect(marked).toContain('>− 2 removed</text>');
    expect(marked).toContain('>New wire</text>');
  });

  it('rejects an isolation of nodes that are not on the level', async () => {
    await expect(
      renderSystemLevelImage(
        graph,
        {
          level: '/',
          expanded: [],
          isolate: { nodeIds: ['gone'], hops: 1 },
          selectedNodeIds: [],
          clocks: false,
        },
        look,
        svg,
        assets,
        roots
      )
    ).rejects.toThrow("'gone' is not a block or port of level '/'");
  });
});

describe('renderIpSymbolImage', () => {
  async function render(crop?: { x: number; y: number; width: number; height: number }) {
    const data = parseIpCoreDocument(fs.readFileSync(LED, 'utf8'), LED);
    const library = await busLibraryFor(data, LED, roots, assets.busLibraries);
    return text(await renderIpSymbolImage(data, library, { crop }, look, svg, assets, roots));
  }

  it('crops to the visible rectangle exactly', async () => {
    const [x, y] = viewBoxOf(await render());
    const cropped = await render({ x: x + 30, y: y + 20, width: 200, height: 150 });
    expect(viewBoxOf(cropped)).toEqual([x + 30, y + 20, 200, 150]);
  });

  it('rounds a fractional crop outwards to whole units', async () => {
    const [x, y] = viewBoxOf(await render());
    const cropped = await render({ x: x + 30.4, y: y + 20.6, width: 200.2, height: 150 });
    expect(viewBoxOf(cropped)).toEqual([x + 30, y + 20, 201, 151]);
  });

  it('fails when the symbol is not in the visible rectangle', async () => {
    await expect(render({ x: -9000, y: -9000, width: 10, height: 10 })).rejects.toThrow(
      'not in the visible area'
    );
  });
});
