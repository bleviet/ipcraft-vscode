/**
 * What the marks of a comparison (issue #302) add to a block, as native SVG: the border and ring
 * of its kind of change, the sign and the count of changes inside in the header, the sign of an
 * external port, and the color of a marked pin label. Mirrors ChangeBadges, BoundaryNode and the
 * `.sd-*[data-change]` rules of systemDiagram.css; the colors are `palette.change` (palette.ts).
 * The marks themselves (`NodeChange`) are the ones the canvas merges into the node data.
 */

import {
  markSign,
  type NodeChange,
  type PinChangeMark,
} from '../../webview/systemDiagram/changeMarks';
import { BADGE_FONT_SIZE, BADGE_LETTER_SPACING } from './decorSvg';
import type { Palette } from './palette';
import { measureText } from './textMetrics';
import { drawText } from './textSvg';

const HEADER_SIGN_SIZE = 12;
const PORT_SIGN_SIZE = 11;
/** `.sd-port-sign`: the offset of the sign from the tag's end away from the pin marker. */
const PORT_SIGN_OFFSET = { east: 5, west: 6 } as const;

/** A header item right-aligned in the title row: it draws itself ending at `right`, centred on `centerY`. */
export interface HeaderItem {
  width: number;
  svg(right: number, centerY: number): string;
}

/** The border of a block with a kind of change: its color, and whether it is dotted and has a ring. */
export interface ChangeBorder {
  color: string;
  /** Version only: a dotted border and no ring. */
  dotted: boolean;
}

/** The border a marked block takes; a selected block keeps the selection outline, so undefined then. */
export function changeBorder(
  change: NodeChange | undefined,
  selected: boolean,
  palette: Palette
): ChangeBorder | undefined {
  return change?.status && !selected
    ? { color: palette.change[change.status], dotted: change.status === 'version' }
    : undefined;
}

/** `stroke-dasharray` of a dotted border of `width` px. */
export const dottedDash = (width: number): string => `${width} ${width + 1}`;

/** The sign of the block's kind of change and the count of changes inside it, left to right. */
export function changeHeaderItems(change: NodeChange | undefined, palette: Palette): HeaderItem[] {
  const items: HeaderItem[] = [];
  if (change?.status) {
    const sign = markSign(change.status);
    const width = measureText(sign, 'sans600', HEADER_SIGN_SIZE);
    const fill = palette.change[change.status];
    items.push({
      width,
      svg: (right, centerY) =>
        drawText(right - width, centerY, sign, {
          face: 'sans600',
          sizePx: HEADER_SIGN_SIZE,
          fill,
        }),
    });
  }
  if (change?.inside !== undefined && change.inside > 0) {
    const text = `~ ${change.inside} inside`;
    const width =
      measureText(text, 'sans600', BADGE_FONT_SIZE) +
      Array.from(text).length * BADGE_LETTER_SPACING;
    items.push({
      width,
      svg: (right, centerY) =>
        drawText(right - width, centerY, text, {
          face: 'sans600',
          sizePx: BADGE_FONT_SIZE,
          fill: palette.change.changed,
          letterSpacing: BADGE_LETTER_SPACING,
        }),
    });
  }
  return items;
}

/** The sign of a marked external port, at the end of the tag away from its pin marker. */
export function portSignSvg(
  change: NodeChange | undefined,
  placement: { side: 'west' | 'east'; width: number; centerY: number },
  palette: Palette
): string {
  if (!change?.status) {
    return '';
  }
  const east = placement.side === 'east';
  return drawText(
    east ? PORT_SIGN_OFFSET.east : placement.width - PORT_SIGN_OFFSET.west,
    placement.centerY,
    markSign(change.status),
    {
      face: 'sans600',
      sizePx: PORT_SIGN_SIZE,
      fill: palette.change[change.status],
      anchor: east ? 'start' : 'end',
    }
  );
}

/** The color of a marked pin label (added or changed connection); undefined for an unmarked pin. */
export function pinChangeColor(
  mark: PinChangeMark | undefined,
  palette: Palette
): string | undefined {
  return mark && palette.change[mark.kind];
}
