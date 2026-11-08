/** Turns a drawn SVG into the bytes of the requested image file. */

import { inflateSync } from 'zlib';
import type { ExportImageFormat } from '../../shared/messages/imageExport';
import type { FontBytes } from '../../shared/render/fontFaces';
import { paletteFor, type RenderTheme } from '../../shared/render/palette';
import { rasterize } from '../../shared/render/raster';
import { woffToSfnt } from '../../shared/render/woffToSfnt';
import { readRequired, type RenderAssets } from './renderResources';
import type { ResourceRoots } from '../ResourceRoots';

/** The files the renderer reads from the installation. */
export type RenderRoots = Pick<
  ResourceRoots,
  'fontsDir' | 'busDefinitionsDir' | 'busDefinitionSchemaPath' | 'resvgWasmPath'
>;

/** The look of the picture; the same for the CLI and the interactive export. */
export interface RenderLook {
  theme: RenderTheme;
  grid: boolean;
  legend: boolean;
  background: 'editor' | 'transparent';
}

export interface ImageEncoding {
  format: ExportImageFormat;
  /** Pixels per SVG unit; PNG and JPG only. */
  scale: number;
  /** JPEG quality, 1-100; JPG only. */
  quality: number;
}

/** The SVG as PNG or JPG bytes; the fonts are the same WOFF files the SVG embeds, as sfnt. */
async function rasterizeSvg(
  svg: string,
  format: 'png' | 'jpg',
  encoding: ImageEncoding,
  theme: RenderTheme,
  fonts: FontBytes,
  wasmPath: string
): Promise<Uint8Array> {
  return rasterize(svg, {
    format,
    scale: encoding.scale,
    quality: encoding.quality,
    background: format === 'jpg' ? paletteFor(theme).background : undefined,
    fonts: Object.values(fonts).map((woff) => woffToSfnt(woff, inflateSync)),
    loadWasm: () => readRequired(wasmPath, 'Rasterizer module'),
  });
}

/** The bytes of the image file for an SVG drawn with the fonts of `assets`. */
export async function encodeImage(
  svg: string,
  encoding: ImageEncoding,
  theme: RenderTheme,
  assets: RenderAssets,
  roots: Pick<RenderRoots, 'fontsDir' | 'resvgWasmPath'>
): Promise<Uint8Array> {
  if (encoding.format === 'svg') {
    return Buffer.from(svg, 'utf8');
  }
  const { bytes } = await assets.fontsFrom(roots.fontsDir);
  return rasterizeSvg(svg, encoding.format, encoding, theme, bytes, roots.resvgWasmPath);
}
