/** One line of text as a native SVG `<text>` element, vertically centred like a browser line box. */

import { MONO_FAMILY, SANS_FAMILY } from './fontFaces';
import type { FaceName } from './fontMetrics.generated';
import { baselineY } from './textMetrics';
import { textElement } from './svg';

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
}

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
      'font-family': style.face === 'mono400' ? MONO_FAMILY : SANS_FAMILY,
      'font-size': style.sizePx,
      'font-weight': style.face === 'sans600' ? 600 : style.weight,
      'font-style': style.italic ? 'italic' : undefined,
      'text-anchor': style.anchor === 'end' || style.anchor === 'middle' ? style.anchor : undefined,
      fill: style.fill,
      'letter-spacing': style.letterSpacing,
      opacity: style.opacity,
    },
    content
  );
}
