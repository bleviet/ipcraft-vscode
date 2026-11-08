/** @jest-environment node */
// The IP core symbol render path in a Node environment: it never touches the DOM or React.
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
import * as vscode from 'vscode';
import { runCliRender, type CliRenderArgs } from '../../../cli/render';
import { devResourceRoots } from '../../../services/ResourceRoots';
import { FONT_FILES } from '../../../shared/render/fontFaces';

const repoRoot = path.resolve(__dirname, '../../../..');
const LED = path.join(repoRoot, 'examples/led_avmm/led_controller_avmm.ip.yml');
const AXI = path.join(repoRoot, 'ipcraft-spec/examples/comprehensive_axi/comprehensive_axi.ip.yml');

let tmp: string;
let roots: ReturnType<typeof devResourceRoots>;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-render-ip-'));
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

function args(input: string, name: string, extra: Partial<CliRenderArgs> = {}): CliRenderArgs {
  return {
    inputPath: input,
    out: path.join(tmp, name),
    level: '/',
    expand: [],
    theme: 'light',
    grid: true,
    legend: true,
    background: 'editor',
    ...extra,
  };
}

async function render(input: string, name: string, extra: Partial<CliRenderArgs> = {}) {
  const result = await runCliRender(args(input, name, extra), roots);
  expect(result.error).toBeUndefined();
  expect(result.success).toBe(true);
  return fs.readFileSync(result.outputPath, 'utf8');
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

function portIds(svg: string): string[] {
  return Array.from(parse(svg).getElementsByTagName('g'))
    .filter((g) => g.hasAttribute('data-port'))
    .map((g) => g.getAttribute('data-port') as string);
}

describe('runCliRender for an .ip.yml', () => {
  const fixtures: Array<[string, string, number]> = [
    ['led_controller_avmm', LED, 1],
    ['comprehensive_axi', AXI, 3],
  ];

  it.each(fixtures)('writes a standalone SVG symbol for %s', async (name, input, minBuses) => {
    const svg = await render(input, `${name}.svg`);
    const doc = parse(svg);
    expect(doc.documentElement?.getAttribute('xmlns')).toBe('http://www.w3.org/2000/svg');
    expect(svg).not.toContain('foreignObject');
    expect(svg).not.toContain('var(');
    expect(svg).not.toContain('class=');
    expect(svg).toContain("font-family:'IBM Plex Mono'");
    const groups = Array.from(doc.getElementsByTagName('g')).filter((g) =>
      g.hasAttribute('data-port')
    );
    const buses = groups.filter((g) => g.getAttribute('data-kind') === 'bus');
    expect(buses.length).toBeGreaterThanOrEqual(minBuses);
    expect(new Set(portIds(svg)).size).toBe(groups.length);
    expect(groups.length).toBeGreaterThan(buses.length);
    expect(svg).toContain('PORTS');
  });

  it('draws one group per port the editor places around the block', async () => {
    const { computeSymbolLayout, symbolLayoutInputs } =
      await import('../../../webview/ipcore/components/canvas/symbolInputs');
    const yaml = await import('yaml');
    const { builtinBusLibrary } = await import('../../helpers/busLibrary');
    const { canonicalizeParsedIpCore } =
      await import('../../../shared/busContracts/ipCoreCanonicalize');
    const library = builtinBusLibrary();
    const parsed = yaml.parse(fs.readFileSync(AXI, 'utf8')) as Record<string, unknown>;
    const ipCore = canonicalizeParsedIpCore(parsed, library).ipCore as never;
    const layout = computeSymbolLayout(ipCore, symbolLayoutInputs(ipCore, library));
    expect(portIds(await render(AXI, 'ids.svg'))).toEqual(layout.ports.map((port) => port.id));
  });

  it('renders the same bytes twice', async () => {
    expect(await render(LED, 'a.svg')).toBe(await render(LED, 'b.svg'));
  });

  it('uses another palette for --theme dark', async () => {
    const light = await render(LED, 'light.svg');
    const dark = await render(LED, 'dark.svg', { theme: 'dark' });
    expect(dark).not.toBe(light);
    expect(dark).toContain('#1f1f1f');
    expect(light).not.toContain('#1f1f1f');
  });

  it('honours --no-grid and --background transparent', async () => {
    const full = await render(LED, 'full.svg');
    expect(full).toContain('ipcraft-grid');
    expect(await render(LED, 'nogrid.svg', { grid: false })).not.toContain('ipcraft-grid');
    const transparent = await render(LED, 'transparent.svg', { background: 'transparent' });
    // The block body keeps its opaque fill; only the page-sized background rect goes away.
    const pageRect = /<\/style><rect [^>]*fill="#ffffff"/;
    expect(full).toMatch(pageRect);
    expect(transparent).not.toMatch(pageRect);
  });

  it('fails cleanly on a broken or unreadable .ip.yml', async () => {
    const broken = path.join(tmp, 'broken.ip.yml');
    fs.writeFileSync(broken, 'vlnv: [unclosed\n');
    const brokenResult = await runCliRender(args(broken, 'broken.svg'), roots);
    expect(brokenResult.success).toBe(false);
    expect(brokenResult.error).toContain('Invalid YAML');

    const scalar = path.join(tmp, 'scalar.ip.yml');
    fs.writeFileSync(scalar, 'just text\n');
    expect((await runCliRender(args(scalar, 'scalar.svg'), roots)).error).toContain(
      'must be a mapping'
    );

    const noVlnv = path.join(tmp, 'novlnv.ip.yml');
    fs.writeFileSync(noVlnv, 'apiVersion: "1.1"\nclocks: []\n');
    expect((await runCliRender(args(noVlnv, 'novlnv.svg'), roots)).error).toContain('no vlnv.name');

    const newer = path.join(tmp, 'newer.ip.yml');
    fs.writeFileSync(newer, 'apiVersion: "9.9"\nvlnv: {name: x}\n');
    const newerResult = await runCliRender(args(newer, 'newer.svg'), roots);
    expect(newerResult.error).toContain('apiVersion 9.9');

    const missing = await runCliRender(args(path.join(tmp, 'absent.ip.yml'), 'x.svg'), roots);
    expect(missing.error).toContain('Input file not found');
    expect(fs.existsSync(path.join(tmp, 'broken.svg'))).toBe(false);
  });

  it('draws header fields that are numbers or missing', async () => {
    const odd = path.join(tmp, 'odd.ip.yml');
    fs.writeFileSync(
      odd,
      'vlnv:\n  name: odd\n  version: 1.0.0\n  library: 2024\nauthor: 42\nclocks:\n  - name: clk\n'
    );
    const svg = await render(odd, 'odd.svg');
    expect(svg).toContain('>2024<');
    expect(svg).toContain('>42<');
    expect(svg).not.toContain('undefined');
  });

  it('draws a numeric description as text', async () => {
    const numeric = path.join(tmp, 'numeric.ip.yml');
    fs.writeFileSync(numeric, 'vlnv:\n  name: n\n  version: 1.0.0\ndescription: 42\n');
    expect(await render(numeric, 'numeric.svg')).toContain('>42<');
  });

  it('badges every reset with its polarity, as the editor does', async () => {
    const svg = await render(LED, 'badge.svg');
    expect(svg).toContain('>H</text>');
  });

  describe('with a custom bus library', () => {
    const XCVR_DIR = path.join(repoRoot, 'ipcraft-spec/examples/xcvr_loopback');
    const XCVR = path.join(XCVR_DIR, 'xcvr_loopback.ip.yml');
    const toggles = (svg: string) => svg.split('data-part="expand-toggle"').length - 1;

    it('gives a bus of the IP-local library its expand toggle', async () => {
      const withLibrary = toggles(await render(XCVR, 'xcvr.svg'));
      expect(withLibrary).toBeGreaterThan(0);

      const text = fs.readFileSync(XCVR, 'utf8').replace(/^useBusLibrary:.*$/m, '');
      const bare = path.join(tmp, 'xcvr_bare.ip.yml');
      fs.writeFileSync(bare, text);
      expect(toggles(await render(bare, 'xcvr_bare.svg'))).toBeLessThan(withLibrary);
    });
  });
});
