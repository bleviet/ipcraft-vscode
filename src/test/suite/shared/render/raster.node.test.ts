/** @jest-environment node */
import * as fs from 'fs';
import * as path from 'path';
import { Resvg } from '@resvg/resvg-wasm';
import { rasterize, type RasterOptions } from '../../../../shared/render/raster';

const wasmPath = path.resolve(
  __dirname,
  '../../../../../node_modules/@resvg/resvg-wasm/index_bg.wasm'
);
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8"/></svg>';
const options = (format: 'png' | 'jpg'): RasterOptions => ({
  format,
  scale: 1,
  quality: 90,
  background: '#ffffff',
  fonts: [],
  loadWasm: async () => fs.readFileSync(wasmPath),
});

describe('rasterize', () => {
  it('retries the wasm load after a failure', async () => {
    const failing = { ...options('png'), loadWasm: async () => Promise.reject(new Error('gone')) };
    await expect(rasterize(SVG, failing)).rejects.toThrow('gone');
    expect((await rasterize(SVG, options('png'))).length).toBeGreaterThan(8);
  });

  describe('wasm memory', () => {
    // Wasm memory never shrinks, so every wasm-side object must be freed on every path.
    const proto = Resvg.prototype as unknown as {
      free(): void;
      render(): { free(): void; asPng(): Uint8Array };
    };
    const realFree = proto.free;
    const realRender = proto.render;
    let resvgFree: jest.Mock;
    let imageFree: jest.Mock;

    beforeEach(() => {
      resvgFree = jest.fn(function (this: unknown) {
        realFree.call(this);
      });
      imageFree = jest.fn();
      proto.free = resvgFree;
    });
    afterEach(() => {
      proto.free = realFree;
      proto.render = realRender;
    });

    /** Wraps `render` so the image's `free` is observed, and `asPng` can be made to throw. */
    function spyOnImage(asPngError?: Error): void {
      proto.render = function (this: unknown) {
        const image = realRender.call(this);
        const realImageFree = image.free.bind(image);
        image.free = () => {
          imageFree();
          realImageFree();
        };
        if (asPngError) {
          image.asPng = () => {
            throw asPngError;
          };
        }
        return image;
      };
    }

    it.each(['png', 'jpg'] as const)(
      'frees the resvg object and the image once for %s',
      async (format) => {
        spyOnImage();
        await rasterize(SVG, options(format));
        expect(resvgFree).toHaveBeenCalledTimes(1);
        expect(imageFree).toHaveBeenCalledTimes(1);
      }
    );

    it('frees the resvg object when render throws', async () => {
      proto.render = () => {
        throw new Error('render failed');
      };
      await expect(rasterize(SVG, options('png'))).rejects.toThrow('render failed');
      expect(resvgFree).toHaveBeenCalledTimes(1);
    });

    it('frees both when asPng throws', async () => {
      spyOnImage(new Error('png failed'));
      await expect(rasterize(SVG, options('png'))).rejects.toThrow('png failed');
      expect(resvgFree).toHaveBeenCalledTimes(1);
      expect(imageFree).toHaveBeenCalledTimes(1);
    });
  });
});
