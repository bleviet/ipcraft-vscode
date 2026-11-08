/** SVG to PNG / JPG with resvg (WebAssembly) and jpeg-js. No file access: callers pass the wasm and font bytes. */
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import encode from 'jpeg-js/lib/encoder';

export type RasterFormat = 'png' | 'jpg';

export interface RasterOptions {
  format: RasterFormat;
  /** Pixels per SVG unit. */
  scale: number;
  /** JPEG quality, 1-100; ignored for PNG. */
  quality: number;
  /** Opaque CSS color under the image; omit for a transparent PNG. JPEG needs one. */
  background?: string;
  /** TTF/OTF font files, matched by family and weight against the SVG text. */
  fonts: Uint8Array[];
  /** Reads the `index_bg.wasm` of @resvg/resvg-wasm; called only while the module is not yet initialized. */
  loadWasm: () => Promise<Uint8Array>;
}

// resvg's WebAssembly instance is process-global and may be initialized only once.
let wasmReady: Promise<void> | undefined;

function ensureWasm(loadWasm: () => Promise<Uint8Array>): Promise<void> {
  wasmReady ??= loadWasm()
    .then(initWasm)
    .catch((err: unknown) => {
      // A failed load is not final: the next call tries again.
      wasmReady = undefined;
      throw err;
    });
  return wasmReady;
}

/** The rendered image as PNG or JPEG bytes. */
export async function rasterize(svg: string, options: RasterOptions): Promise<Uint8Array> {
  if (options.format === 'jpg' && options.background === undefined) {
    throw new Error('A JPG needs an opaque background');
  }
  await ensureWasm(options.loadWasm);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: options.scale },
    font: {
      loadSystemFonts: false,
      fontBuffers: options.fonts,
      defaultFontFamily: 'IBM Plex Sans',
    },
    background: options.background,
  });
  // Both wasm-side objects are freed, or repeated renders in one process exhaust wasm memory.
  let image: ReturnType<typeof resvg.render> | undefined;
  try {
    image = resvg.render();
    if (options.format === 'png') {
      return image.asPng();
    }
    const { width, height, pixels } = image;
    const jpeg = encode({ data: pixels, width, height }, options.quality);
    return new Uint8Array(jpeg.data);
  } finally {
    image?.free();
    resvg.free();
  }
}
