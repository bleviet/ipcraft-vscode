/** One line of text as a native SVG `<text>` element, vertically centred like a browser line box. */

import { MONO_FAMILY, SANS_FAMILY } from './fontFaces';
import type { FaceName } from './fontMetrics.generated';
import { baselineY } from './textMetrics';
import { textElement } from './svg';

export interface TextStyle {
  face: FaceName;
  sizePx: number;
  fill: string;
  anchor?: 'start' | 'end';
  italic?: boolean;
}

export function drawText(x: number, centerY: number, content: string, style: TextStyle): string {
  return textElement(
    {
      x,
      y: baselineY(centerY, style.face, style.sizePx),
      'font-family': style.face === 'mono400' ? MONO_FAMILY : SANS_FAMILY,
      'font-size': style.sizePx,
      'font-weight': style.face === 'sans600' ? 600 : undefined,
      'font-style': style.italic ? 'italic' : undefined,
      'text-anchor': style.anchor === 'end' ? 'end' : undefined,
      fill: style.fill,
    },
    content
  );
}
