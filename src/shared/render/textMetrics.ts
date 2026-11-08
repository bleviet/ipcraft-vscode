/**
 * Text measurement from the bundled IBM Plex advance widths, so the CLI lays text out and draws
 * it with the same metrics and no browser. Widths assume no kerning (the SVG sets
 * `font-kerning: none` and unhinted `text-rendering: geometricPrecision`), so measured and drawn
 * widths agree.
 */

import type { TextMeasure, TextWeight } from '../../webview/systemDiagram/layout/nodeSizing';
import { FONT_METRICS, type FaceName } from './fontMetrics.generated';

/** Characters outside the table (non-Latin, rare symbols) are measured as `M`, a wide letter, so text never overflows. */
const FALLBACK_CHARACTER = 'M';

export interface TextFace {
  face: FaceName;
  sizePx: number;
}

/** Faces by the webview's weights: body 11 px, block names 12 px semibold, subtitles 10.5 px mono. */
export const WEIGHT_FACES: Readonly<Record<TextWeight, TextFace>> = {
  normal: { face: 'sans400', sizePx: 11 },
  semibold: { face: 'sans600', sizePx: 12 },
  subtitle: { face: 'mono400', sizePx: 10.5 },
};

/** Pixel width of `text` set in `face` at `sizePx`. */
export function measureText(text: string, face: FaceName, sizePx: number): number {
  const metrics = FONT_METRICS[face];
  const fallback = metrics.advances[FALLBACK_CHARACTER.charCodeAt(0)];
  let units = 0;
  for (const char of text) {
    units += metrics.advances[char.codePointAt(0) ?? 0] ?? fallback;
  }
  return (units / metrics.unitsPerEm) * sizePx;
}

/** The webview's {@link TextMeasure}, backed by the Plex metrics. */
export const plexTextMeasure: TextMeasure = (text, weight) => {
  const { face, sizePx } = WEIGHT_FACES[weight];
  return measureText(text, face, sizePx);
};

/**
 * Baseline y of a single line of `face` text centred vertically on `centerY`: the middle of the
 * font's ascent-to-descent box sits on `centerY`, as a browser centres a line box.
 */
export function baselineY(centerY: number, face: FaceName, sizePx: number): number {
  const { ascent, descent, unitsPerEm } = FONT_METRICS[face];
  return centerY + (((ascent - descent) / 2) * sizePx) / unitsPerEm;
}

/** `text` cut at the end with an ellipsis when wider than `maxWidth` (CSS `text-overflow: ellipsis`). */
export function truncateEnd(text: string, maxWidth: number, { face, sizePx }: TextFace): string {
  if (measureText(text, face, sizePx) <= maxWidth) {
    return text;
  }
  const chars = Array.from(text);
  let kept = chars.length;
  while (kept > 0 && measureText(`${chars.slice(0, kept).join('')}…`, face, sizePx) > maxWidth) {
    kept -= 1;
  }
  return `${chars.slice(0, kept).join('')}…`;
}
