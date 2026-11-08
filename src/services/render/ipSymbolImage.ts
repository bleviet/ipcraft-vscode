/**
 * Draws the IP core symbol of an `.ip.yml` text, as the IP core editor's canvas shows it, to image
 * bytes. Shared by `ipcraft render` and the editor's Export image. The bus library is the caller's:
 * the CLI loads the built-in definitions, the editor passes the library it already resolved.
 */

import * as path from 'path';
import * as yaml from 'yaml';
import { canonicalizeParsedIpCore } from '../../shared/busContracts/ipCoreCanonicalize';
import type { NormalizedBusLibrary } from '../../shared/busContracts';
import { readIpCoreFormatVersion } from '../../shared/ipCoreFormat';
import type { ExportRect } from '../../shared/messages/imageExport';
import { renderIpSymbolSvg } from '../../shared/render/ipSymbolSvg';
import { paletteFor } from '../../shared/render/palette';
import type { IpCore } from '../../webview/types/ipCore';
import {
  clockDomainColor,
  computeSymbolLayout,
  hasMultipleClockDomains,
  isExpandableBus,
  symbolLayoutInputs,
} from '../../webview/ipcore/components/canvas/symbolInputs';
import {
  encodeImage,
  type ImageEncoding,
  type RenderLook,
  type RenderRoots,
} from './imageEncoding';
import type { RenderAssets } from './renderResources';

/** The parsed mapping of an `.ip.yml`, after the format-version and `vlnv.name` checks. */
export function parseIpCoreDocument(text: string, inputPath: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = yaml.parse(text);
  } catch (err) {
    throw new Error(`Invalid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid YAML: an .ip.yml must be a mapping');
  }
  const data = parsed as Record<string, unknown>;
  const version = readIpCoreFormatVersion(data);
  if (!version.ok) {
    throw new Error(version.message);
  }
  const vlnv = data.vlnv as Record<string, unknown> | undefined;
  if (!vlnv || typeof vlnv !== 'object' || !vlnv.name) {
    throw new Error(`'${inputPath}' is not an IP core: it has no vlnv.name`);
  }
  return data;
}

/** The folder of the IP's own `useBusLibrary`, resolved against the file; '' when it has none. */
export function ipLocalBusFolder(data: Record<string, unknown>, inputPath: string): string {
  return typeof data.useBusLibrary === 'string' && data.useBusLibrary !== ''
    ? path.resolve(path.dirname(inputPath), data.useBusLibrary)
    : '';
}

/** What to draw of the symbol. */
export interface IpSymbolRequest {
  /** Crop to this rectangle of the symbol's layout coordinates (the canvas's visible part). */
  crop?: ExportRect;
}

function drawIpSymbol(
  data: Record<string, unknown>,
  library: NormalizedBusLibrary,
  request: IpSymbolRequest,
  look: RenderLook,
  fontFaceCss: string
): string {
  const ipCore = canonicalizeParsedIpCore(data, library).ipCore as unknown as IpCore;
  const inputs = symbolLayoutInputs(ipCore, library);
  const layout = computeSymbolLayout(ipCore, inputs);
  const multiDomain = hasMultipleClockDomains(ipCore);
  return renderIpSymbolSvg(layout, {
    palette: paletteFor(look.theme),
    grid: look.grid,
    background: look.background,
    fontFaceCss,
    crop: request.crop,
    domainColor: (idx) => clockDomainColor(idx, multiDomain),
    expandable: (port) =>
      isExpandableBus(port.data as { type?: string; conduitPorts?: unknown[] }, inputs.busDefs),
  });
}

/** The bytes of the image file of an IP core symbol; `data` comes from {@link parseIpCoreDocument}. */
export async function renderIpSymbolImage(
  data: Record<string, unknown>,
  library: NormalizedBusLibrary,
  request: IpSymbolRequest,
  look: RenderLook,
  encoding: ImageEncoding,
  assets: RenderAssets,
  roots: Pick<RenderRoots, 'fontsDir' | 'resvgWasmPath'>
): Promise<Uint8Array> {
  const { css } = await assets.fontsFrom(roots.fontsDir);
  return encodeImage(
    drawIpSymbol(data, library, request, look, css),
    encoding,
    look.theme,
    assets,
    roots
  );
}
