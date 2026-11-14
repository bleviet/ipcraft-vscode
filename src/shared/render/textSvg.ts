/** One line of text as a native SVG `<text>` element, vertically centred like a browser line box. */

import { MONO_FAMILY, SANS_FAMILY, SANS_SEMIBOLD_FAMILY } from './fontFaces';
import type { FaceName } from './fontMetrics.generated';
import { baselineY } from './textMetrics';
import { textElement } from './svg';

const FAMILIES: Record<FaceName, string> = {
  sans400: SANS_FAMILY,
  sans600: SANS_SEMIBOLD_FAMILY,
  mono400: MONO_FAMILY,
};

export interface TextStyle {
  face: FaceName;
  sizePx: number;
  fill: string;
  anchor?: 'start' | 'middle' | 'end';
  italic?: boolean;
  /** Weight for a face without that weight's file (the viewer synthesizes it, as the canvas does). */
  weight?: 600 | 700;
  /** Extra space after each character, in px. */
  letterSpacing?: number;
  opacity?: number;
  /** Struck through: the name of something a comparison removed. */
  strike?: boolean;
  /** Outline color painted behind the glyphs (a halo that keeps the text legible over wires). */
  halo?: string;
}

/** Width of the halo outline; the canvas blurs a 3 px text-shadow twice. */
const HALO_WIDTH = 3;

export function drawText(x: number, centerY: number, content: string, style: TextStyle): string {
  return drawTextOnBaseline(x, baselineY(centerY, style.face, style.sizePx), content, style);
}

/** One line of text whose baseline sits at `y` (SVG text without `dominant-baseline`). */
export function drawTextOnBaseline(
  x: number,
  y: number,
  content: string,
  style: TextStyle
): string {
  return textElement(
    {
      x,
      y,
      'font-family': FAMILIES[style.face],
      'font-size': style.sizePx,
      'font-weight': style.face === 'sans600' ? 600 : style.weight,
      'font-style': style.italic ? 'italic' : undefined,
      'text-anchor': style.anchor === 'end' || style.anchor === 'middle' ? style.anchor : undefined,
      fill: style.fill,
      'letter-spacing': style.letterSpacing,
      opacity: style.opacity,
      'text-decoration': style.strike ? 'line-through' : undefined,
      stroke: style.halo,
      'stroke-width': style.halo === undefined ? undefined : HALO_WIDTH,
      'stroke-linejoin': style.halo === undefined ? undefined : 'round',
      'paint-order': style.halo === undefined ? undefined : 'stroke',
    },
    content
  );
}
