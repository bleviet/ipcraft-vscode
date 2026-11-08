/** @jest-environment node */
// PNG and JPG output of `ipcraft render`, in a Node environment (no jsdom).
jest.mock('@xyflow/react', () => {
  throw new Error('React must not load on the render path');
});
jest.mock('react', () => {
  throw new Error('React must not load on the render path');
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { inflateSync } from 'zlib';
import * as vscode from 'vscode';
import { runCliRender, type CliRenderArgs } from '../../../cli/render';
import { devResourceRoots } from '../../../services/ResourceRoots';
import { FONT_FILES } from '../../../shared/render/fontFaces';

const repoRoot = path.resolve(__dirname, '../../../..');
const ZYNQ = path.join(repoRoot, 'src/test/fixtures/system-design/zynq_dma_system.tcl');
const LED = path.join(repoRoot, 'examples/led_avmm/led_controller_avmm.ip.yml');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

jest.setTimeout(30000);

let tmp: string;
let roots: ReturnType<typeof devResourceRoots>;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ipcraft-raster-'));
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
    scale: 2,
    quality: 90,
    ...extra,
  };
}

async function render(input: string, name: string, extra: Partial<CliRenderArgs> = {}) {
  const result = await runCliRender(args(input, name, extra), roots);
  expect(result.error).toBeUndefined();
  expect(result.success).toBe(true);
  return fs.readFileSync(result.outputPath);
}

function svgSize(svg: Buffer): { width: number; height: number } {
  const text = svg.toString('utf8');
  return {
    width: Number(/<svg[^>]*\swidth="([\d.]+)"/.exec(text)?.[1]),
    height: Number(/<svg[^>]*\sheight="([\d.]+)"/.exec(text)?.[1]),
  };
}

interface Png {
  width: number;
  height: number;
  colorType: number;
  /** RGBA when colorType is 6. */
  pixels: Buffer;
}

/** Decodes an 8-bit RGBA or RGB non-interlaced PNG (what resvg writes). */
function decodePng(png: Buffer): Png {
  expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  expect(png.toString('latin1', 12, 16)).toBe('IHDR');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const colorType = png[25];
  const channels = colorType === 6 ? 4 : 3;
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString('latin1', at + 4, at + 8) === 'IDAT') {
      idat.push(png.subarray(at + 8, at + 8 + length));
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x];
      const left = x >= channels ? pixels[y * stride + x - channels] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels] : 0;
      let predictor = 0;
      if (filter === 1) {
        predictor = left;
      } else if (filter === 2) {
        predictor = up;
      } else if (filter === 3) {
        predictor = (left + up) >> 1;
      } else if (filter === 4) {
        const p = left + up - upLeft;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - upLeft)];
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      pixels[y * stride + x] = (value + predictor) & 255;
    }
  }
  return { width, height, colorType, pixels };
}

/** Width and height from the SOF marker of a JPEG, after checking the SOI and EOI markers. */
function jpegSize(jpeg: Buffer): { width: number; height: number } {
  expect([jpeg[0], jpeg[1]]).toEqual([0xff, 0xd8]);
  expect([jpeg[jpeg.length - 2], jpeg[jpeg.length - 1]]).toEqual([0xff, 0xd9]);
  for (let at = 2; at < jpeg.length; ) {
    const marker = jpeg[at + 1];
    if (marker === 0xc0) {
      return { height: jpeg.readUInt16BE(at + 5), width: jpeg.readUInt16BE(at + 7) };
    }
    at += 2 + jpeg.readUInt16BE(at + 2);
  }
  throw new Error('No SOF0 marker');
}

/** Number of pixels clearly darker than the light background (text and lines). */
function darkPixels(image: Png): number {
  const channels = image.colorType === 6 ? 4 : 3;
  let count = 0;
  for (let i = 0; i < image.pixels.length; i += channels) {
    if (image.pixels[i] < 100 && image.pixels[i + 1] < 100 && image.pixels[i + 2] < 100) {
      count++;
    }
  }
  return count;
}

describe('runCliRender PNG and JPG', () => {
  it.each([
    ['zynq_dma_system', ZYNQ],
    ['led_controller_avmm', LED],
  ])('writes a PNG of %s at scale 1 and 2, sized from the SVG', async (name, input) => {
    const { width, height } = svgSize(await render(input, `${name}.svg`));
    for (const scale of [1, 2]) {
      const png = await render(input, `${name}-${scale}.png`, { scale });
      expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([
        Math.ceil(width * scale),
        Math.ceil(height * scale),
      ]);
    }
  });

  it.each([
    ['zynq_dma_system', ZYNQ],
    ['led_controller_avmm', LED],
  ])('writes a JPG of %s with SOI, EOI and SOF0 dimensions', async (name, input) => {
    const { width, height } = svgSize(await render(input, `${name}-j.svg`));
    const size = jpegSize(await render(input, `${name}.jpg`, { scale: 1 }));
    expect(size).toEqual({ width: Math.ceil(width), height: Math.ceil(height) });
    const jpeg = await render(input, `${name}.jpeg`, { scale: 1, quality: 20 });
    expect(jpegSize(jpeg).width).toBe(size.width);
    expect(jpeg.length).toBeLessThan((await render(input, `${name}-q.jpg`, { scale: 1 })).length);
  });

  it('writes identical bytes for the same input twice', async () => {
    const first = await render(ZYNQ, 'a.png');
    expect((await render(ZYNQ, 'b.png')).equals(first)).toBe(true);
  });

  it('keeps the alpha channel and transparent corners for --background transparent', async () => {
    const image = decodePng(
      await render(ZYNQ, 't.png', { background: 'transparent', grid: false, scale: 1 })
    );
    expect(image.colorType).toBe(6);
    for (const [x, y] of [
      [0, 0],
      [image.width - 1, 0],
      [0, image.height - 1],
      [image.width - 1, image.height - 1],
    ]) {
      expect(image.pixels[(y * image.width + x) * 4 + 3]).toBe(0);
    }
  });

  it('draws text with the bundled fonts', async () => {
    const withFonts = decodePng(await render(ZYNQ, 'fonts.png', { grid: false, scale: 1 }));
    // Without font files resvg draws no text at all, so the ink differs by the glyphs.
    const svg = (await render(ZYNQ, 'plain.svg', { grid: false })).toString('utf8');
    const { rasterize } = await import('../../../shared/render/raster');
    const bare = await rasterize(svg.replace(/<style[\s\S]*?<\/style>/, ''), {
      format: 'png',
      scale: 1,
      quality: 90,
      fonts: [],
      loadWasm: async () => fs.readFileSync(roots.resvgWasmPath),
    });
    expect(darkPixels(withFonts)).toBeGreaterThan(darkPixels(decodePng(Buffer.from(bare))));
  });

  it('draws weight 600 text with the semibold face', async () => {
    const { rasterize } = await import('../../../shared/render/raster');
    const { drawText } = await import('../../../shared/render/textSvg');
    const { woffToSfnt } = await import('../../../shared/render/woffToSfnt');
    const fonts = Object.values(FONT_FILES).map((file) =>
      woffToSfnt(new Uint8Array(fs.readFileSync(path.join(tmp, 'fonts', file))), inflateSync)
    );
    const ink = async (face: 'sans400' | 'sans600') => {
      const text = drawText(4, 20, 'WWWW minimum', { face, sizePx: 24, fill: '#000000' });
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="40">${text}</svg>`;
      const png = await rasterize(svg, {
        format: 'png',
        scale: 1,
        quality: 90,
        background: '#ffffff',
        fonts,
        loadWasm: async () => fs.readFileSync(roots.resvgWasmPath),
      });
      return darkPixels(decodePng(Buffer.from(png)));
    };
    expect(await ink('sans600')).toBeGreaterThan((await ink('sans400')) * 1.1);
  });
});
