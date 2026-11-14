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

/** The border of a block with a kind of change: its color, and whether it is solid (with a ring), dotted or dashed. */
export interface ChangeBorder {
  color: string;
  /** Version only: dotted, no ring. Removed (a ghost): dashed, no ring. Else solid with a ring. */
  line: 'solid' | 'dotted' | 'dashed';
}

/** `.sd-node[data-change='removed'] > :not(.sd-node-head)`: the body of a ghost is dimmed to this opacity. */
export const GHOST_BODY_OPACITY = 0.65;
/** The dashes of the border of a ghost block (a black box's border has the same). */
export const GHOST_DASH = '4 3';
/** The dashes of a wire only the base has: the canvas and the legend bar draw it the same. */
export const REMOVED_WIRE_DASH = '6 4';

/** Whether `change` marks the ghost of a block or port that only the base has. */
export const isGhost = (change: NodeChange | undefined): boolean => change?.status === 'removed';

/** The border a marked block takes; a selected block keeps the selection outline, so undefined then. */
export function changeBorder(
  change: NodeChange | undefined,
  selected: boolean,
  palette: Palette
): ChangeBorder | undefined {
  return change?.status && !selected
    ? {
        color: palette.change[change.status],
        line:
          change.status === 'version' ? 'dotted' : change.status === 'removed' ? 'dashed' : 'solid',
      }
    : undefined;
}

/** `stroke-dasharray` of a dotted border of `width` px. */
export const dottedDash = (width: number): string => `${width} ${width + 1}`;

/** `stroke-dasharray` of the border of a block of `width` px, undefined for a solid or an unmarked one. */
export const borderDash = (border: ChangeBorder | undefined, width: number): string | undefined =>
  border?.line === 'dotted'
    ? dottedDash(width)
    : border?.line === 'dashed'
      ? GHOST_DASH
      : undefined;

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
