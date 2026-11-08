/** @jest-environment node */
jest.mock('@xyflow/react', () => {
  throw new Error('React must not load on the render path');
});
jest.mock('react', () => {
  throw new Error('React must not load on the render path');
});

// `ipcraft render --manifest` (issue #268, step 5).
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseArgs } from '../../../cli/argv';
import { runCliRender, type CliRenderArgs } from '../../../cli/render';
import { runCliRenderManifest } from '../../../cli/renderManifest';
import { duplicateOutput, entryArgv, parseManifest } from '../../../cli/renderManifestSpec';
import { devResourceRoots } from '../../../services/ResourceRoots';
import { FONT_FILES } from '../../../shared/render/fontFaces';

const repoRoot = path.resolve(__dirname, '../../../..');
const fixtures = path.join(repoRoot, 'src/test/fixtures');
const ZYNQ = path.join(fixtures, 'system-design/zynq_dma_system.tcl');
const CLOCKS = path.join(fixtures, 'system-design/zynq_clock_domains.tcl');
const IP = path.join(repoRoot, 'ipcraft-spec/examples/comprehensive_axi/comprehensive_axi.ip.yml');

let tmp: string;
let roots: ReturnType<typeof devResourceRoots>;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-manifest-'));
  const fontsDir = path.join(tmp, 'fonts');
  fs.mkdirSync(fontsDir);
  for (const file of Object.values(FONT_FILES)) {
    const family = file.startsWith('ibm-plex-mono') ? 'ibm-plex-mono' : 'ibm-plex-sans';
    fs.copyFileSync(
      path.join(repoRoot, 'node_modules/@fontsource', family, 'files', file),
      path.join(fontsDir, file)
    );
  }
  fs.mkdirSync(path.join(tmp, 'src'));
  fs.copyFileSync(IP, path.join(tmp, 'src/core.ip.yml'));
  fs.copyFileSync(ZYNQ, path.join(tmp, 'src/system.tcl'));
  fs.copyFileSync(CLOCKS, path.join(tmp, 'src/clocks.tcl'));
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

async function run(manifest: string) {
  const file = path.join(tmp, `m${Math.random().toString(36).slice(2)}.yml`);
  fs.writeFileSync(file, manifest);
  const rendered: string[] = [];
  const failed: string[] = [];
  const code = await runCliRenderManifest(file, roots, {
    rendered: (out) => rendered.push(out),
    failed: (message) => failed.push(message),
  });
  return { code, rendered, failed };
}

async function single(input: string, out: string, extra: Partial<CliRenderArgs> = {}) {
  const args: CliRenderArgs = {
    inputPath: path.join(tmp, input),
    out: path.join(tmp, out),
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
  const result = await runCliRender(args, roots);
  expect(result.error).toBeUndefined();
  return fs.readFileSync(result.outputPath);
}

describe('rendering a manifest', () => {
  it('writes every image, in order, identical to the single renders', async () => {
    const result = await run(`
defaults: { theme: dark, scale: 3, legend: false }
images:
  - source: src/core.ip.yml
    out: img/deep/core.svg
  - source: src/system.tcl
    out: img/dma.png
    select: [axi_dma_0]
    hops: 2
    theme: light
  - source: src/clocks.tcl
    out: img/clocks.svg
    clocks: true
`);
    expect(result.failed).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.rendered).toEqual(
      ['img/deep/core.svg', 'img/dma.png', 'img/clocks.svg'].map((f) => path.join(tmp, f))
    );
    const read = (f: string) => fs.readFileSync(path.join(tmp, f));
    expect(read('img/deep/core.svg')).toEqual(
      await single('src/core.ip.yml', 'a.svg', { theme: 'dark', legend: true })
    );
    expect(read('img/dma.png')).toEqual(
      await single('src/system.tcl', 'b.png', {
        select: ['axi_dma_0'],
        hops: 2,
        scale: 3,
        legend: false,
      })
    );
    expect(read('img/clocks.svg')).toEqual(
      await single('src/clocks.tcl', 'c.svg', { theme: 'dark', clocks: true, legend: false })
    );
  });

  it('reports entry errors with their index and renders the others', async () => {
    const result = await run(`
images:
  - { source: src/core.ip.yml, out: ok1.svg, bogus: 1 }
  - { source: src/system.tcl, out: ok2.svg, hops: 0, select: a }
  - { source: src/missing.tcl, out: ok3.svg }
  - { source: src/core.ip.yml, out: ok4.jpg, background: transparent }
  - { out: ok5.svg }
  - { source: src/core.ip.yml, out: ok6.svg }
`);
    expect(result.code).toBe(1);
    expect(result.rendered).toEqual([path.join(tmp, 'ok6.svg')]);
    expect(result.failed).toHaveLength(5);
    expect(result.failed[0]).toMatch(/^images\[0\] \(src\/core.ip.yml\): unknown key 'bogus'/);
    expect(result.failed[1]).toBe(
      "images[1] (src/system.tcl): Invalid --hops '0': expected an integer of at least 1"
    );
    expect(result.failed[2]).toMatch(/^images\[2\] \(src\/missing.tcl\): Input file not found/);
    expect(result.failed[3]).toBe(
      'images[3] (src/core.ip.yml): JPG cannot be transparent; use .png or --background editor'
    );
    expect(result.failed[4]).toBe("images[4]: missing 'source'");
    expect(fs.existsSync(path.join(tmp, 'ok1.svg'))).toBe(false);
  });

  it('applies options to an entry as the flags do', async () => {
    const result = await run(`
images:
  - { source: src/core.ip.yml, out: e1.svg, scale: 2 }
  - { source: src/core.ip.yml, out: e2.svg, legend: false }
  - { source: src/system.tcl, out: e3.svg, level: no }
  - { source: src/system.tcl, out: e4.svg, select: 4 }
  - { source: src/system.tcl, out: e5.svg, workspace: false }
`);
    expect(result.failed.map((m) => m.replace(/ \(.*?\)/, ''))).toEqual([
      'images[0]: --scale applies to PNG and JPG, not to an .svg output',
      "images[1]: Option '--no-legend' is only for system designs, not for an .ip.yml",
      "images[2]: Invalid --level 'no': expected a path such as '/' or '/dsp_pipeline'",
      "images[3]: Invalid 'select': expected a name or a list of names",
    ]);
    expect(result.rendered).toEqual([path.join(tmp, 'e5.svg')]);
  });

  it('fails on a manifest that is not valid as a whole', async () => {
    for (const text of [
      'x: 1',
      'images: 3',
      'defaults: { nope: 1 }\nimages: [{}]',
      'images: []',
      'defaults: { out: a.svg }\nimages: [{}]',
      '[',
      'images: []\nfoo: 1',
    ]) {
      const result = await run(text);
      expect(result.code).toBe(1);
      expect(result.rendered).toEqual([]);
      expect(result.failed).toHaveLength(1);
    }
    const missing = await runCliRenderManifest(path.join(tmp, 'none.yml'), roots, {
      rendered: () => undefined,
      failed: () => undefined,
    });
    expect(missing).toBe(1);
  });
});

describe('manifest spec', () => {
  const dir = path.join(os.tmpdir(), 'm');
  const at = (name: string) => path.join(dir, name);

  it('skips defaults an entry cannot use, but keeps an explicit key', () => {
    const defaults = { scale: 2, quality: 80, legend: false, hops: 2, theme: 'dark' };
    expect(entryArgv({ source: 'a.ip.yml', out: 'o.png' }, defaults, dir)).toEqual([
      at('a.ip.yml'),
      '--out',
      at('o.png'),
      '--scale',
      '2',
      '--theme',
      'dark',
    ]);
    expect(entryArgv({ source: 'd.tcl', out: 'o.svg', select: 'x,y' }, defaults, dir)).toEqual([
      at('d.tcl'),
      '--out',
      at('o.svg'),
      '--no-legend',
      '--hops',
      '2',
      '--theme',
      'dark',
      '--select',
      'x,y',
    ]);
  });

  it('resolves a workspace folder against the manifest and maps false to none', () => {
    expect(entryArgv({ source: 'd.tcl', out: 'o.svg', workspace: '../ip' }, {}, dir)).toEqual([
      at('d.tcl'),
      '--out',
      at('o.svg'),
      '--workspace',
      path.resolve(dir, '../ip'),
    ]);
    expect(entryArgv({ source: 'd.tcl', out: 'o.svg', workspace: null }, {}, dir)).toContain(
      '--no-workspace'
    );
  });

  it('rejects source and out in defaults and an empty image list', () => {
    expect(parseManifest('defaults: { out: a.svg }\nimages: [{}]')).toEqual({
      error: "defaults: 'out' and 'source' must be set on each image",
    });
    expect(parseManifest('defaults: { source: a.tcl }\nimages: [{}]')).toHaveProperty('error');
    expect(parseManifest('images: []')).toEqual({ error: 'no images to render' });
    expect(duplicateOutput([{ out: 'a.svg' }, { out: './x/../a.svg' }], dir)).toBe(at('a.svg'));
    expect(duplicateOutput([{ out: 'a.svg' }, { out: 'b.svg' }], dir)).toBeUndefined();
  });

  it('refuses a manifest where two images write one file', async () => {
    const result = await run(`
images:
  - { source: src/core.ip.yml, out: dup.svg }
  - { source: src/core.ip.yml, out: sub/../dup.svg }
`);
    expect(result.code).toBe(1);
    expect(result.rendered).toEqual([]);
    expect(result.failed[0]).toContain('several images write');
  });
});

describe('command line', () => {
  it('takes only the manifest', () => {
    expect(parseArgs(['render', '--manifest', 'm.yml'])).toEqual({
      kind: 'renderManifest',
      manifestPath: 'm.yml',
    });
    for (const rest of [
      ['--manifest', 'm.yml', '--out', 'x.svg'],
      ['d.tcl', '--manifest', 'm.yml'],
      ['--theme', 'dark', '--manifest', 'm.yml'],
    ]) {
      expect(parseArgs(['render', ...rest])).toMatchObject({ kind: 'error' });
    }
    expect(parseArgs(['render', '--manifest'])).toEqual({
      kind: 'error',
      message: 'Missing value for --manifest',
    });
  });
});
