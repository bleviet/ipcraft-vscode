/**
 * What the canvas adds to a block in the selection and Clocks and resets modes, as native SVG:
 * the selection outline, the domain strip and count in the header, pin marks and frequency
 * labels. Mirrors systemDiagram.css (`.sd-node[data-selected]`, `.sd-node-strip`, `.sd-node-dom`,
 * `.sd-pin-freq`, `[data-crossing]`) and PinFrequency; the geometry is theirs.
 */

import {
  domainBadge,
  type DomainSegment,
  type NodeDomains,
} from '../../webview/systemDiagram/clocks/domainView';
import { frequencyBelowWire, type PinMark } from '../../webview/systemDiagram/clocks/nodeView';
import { resolveColor, type Palette } from './palette';
import { element, num } from './svg';
import { measureText } from './textMetrics';
import { drawText } from './textSvg';

const STRIP_HEIGHT = 3;
const STRIP_RADIUS = 3;
export const BADGE_FONT_SIZE = 9.5;
export const BADGE_LETTER_SPACING = 0.06 * BADGE_FONT_SIZE;
/** Gap between the block name and the domain count in the header title. */
export const BADGE_GAP = 6;
const FREQUENCY_FONT_SIZE = 10;
const FREQUENCY_OFFSET = 2;
const FREQUENCY_LINE = 12;
const FREQUENCY_MARGIN = 8;

/** A block border: the selection outline, the crossing-end warning or the plain line. */
export interface Border {
  color: string;
  opacity: number;
}

/** Border color of a block: the selection outline wins over a crossing end, which wins over the plain line. */
export function blockBorder(palette: Palette, selected: boolean, crossingEnd: boolean): Border {
  if (selected) {
    return { color: palette.focusBorder, opacity: 1 };
  }
  return crossingEnd ? { color: palette.warning, opacity: 1 } : palette.nodeLine;
}

/** The ring outside a selected block (`box-shadow: 0 0 0 <width> focusBorder`), or in `color` for a changed block. */
export function selectionRing(
  size: { width: number; height: number },
  width: number,
  radius: number,
  palette: Palette,
  color: string = palette.focusBorder
): string {
  return element('rect', {
    x: -width / 2,
    y: -width / 2,
    width: size.width + width,
    height: size.height + width,
    rx: radius + width / 2,
    fill: 'none',
    stroke: color,
    'stroke-width': width,
  });
}

/** One path per domain segment of the strip along the top of the header, rounded at the outer top corners. */
export function domainStripSvg(
  segments: readonly DomainSegment[],
  box: { width: number; border: number },
  palette: Palette
): string {
  const inner = box.width - 2 * box.border;
  const each = inner / segments.length;
  const r = STRIP_RADIUS;
  return segments
    .map((segment, index) => {
      const left = box.border + index * each;
      const right = left + each;
      const top = box.border;
      const bottom = top + STRIP_HEIGHT;
      const rl = index === 0 ? r : 0;
      const rr = index === segments.length - 1 ? r : 0;
      const arc = (radius: number, dx: number, dy: number) =>
        radius ? ` a${num(radius)},${num(radius)} 0 0 1 ${num(dx)},${num(dy)}` : '';
      const d =
        `M${num(left)},${num(bottom)} V${num(top + rl)}${arc(rl, rl, -rl)}` +
        ` H${num(right - rr)}${arc(rr, rr, rr)} V${num(bottom)} Z`;
      return element('path', { d, fill: resolveColor(palette, segment.color) });
    })
    .join('');
}

export interface HeaderBadge {
  text: string;
  warning: boolean;
  width: number;
}

/** The crossing or domain count of a header (undefined when it shows none) and the width it takes. */
export function headerBadge(domains: NodeDomains | undefined): HeaderBadge | undefined {
  const badge = domains && domainBadge(domains);
  return (
    badge && {
      text: badge.text,
      warning: badge.warning,
      width:
        measureText(badge.text, 'sans600', BADGE_FONT_SIZE) +
        Array.from(badge.text).length * BADGE_LETTER_SPACING,
    }
  );
}

/** The header count, ending at `right`, centred on `centerY`. */
export function headerBadgeSvg(
  badge: HeaderBadge,
  right: number,
  centerY: number,
  palette: Palette
): string {
  return drawText(right - badge.width, centerY, badge.text, {
    face: 'sans600',
    sizePx: BADGE_FONT_SIZE,
    fill: badge.warning ? palette.warning : palette.descriptionForeground,
    letterSpacing: BADGE_LETTER_SPACING,
  });
}

/** Marker color of a pin mark (domain color), as fixed by the palette; undefined without one. */
export function markColor(mark: PinMark | undefined, palette: Palette): string | undefined {
  return mark?.color === undefined ? undefined : resolveColor(palette, mark.color);
}

/**
 * The frequency of a clock pin, outside the block beside the wire at `(edgeX, centerY)`: above the
 * wire on the east side, below it on the west side or where a net badge takes the place above.
 */
export function frequencySvg(
  mark: PinMark | undefined,
  placement: {
    side: 'west' | 'east';
    /** The block's outer edge on the pin's side. */
    edgeX: number;
    /** Border thickness: the label is placed from the padding edge, as the canvas does. */
    border: number;
    centerY: number;
    hasBadge: boolean;
  },
  palette: Palette
): string {
  if (mark?.frequency === undefined) {
    return '';
  }
  const east = placement.side === 'east';
  const below = frequencyBelowWire(placement.side, placement.hasBadge);
  const inner = east ? placement.edgeX - placement.border : placement.edgeX + placement.border;
  const offset = FREQUENCY_OFFSET + FREQUENCY_LINE / 2;
  return drawText(
    east ? inner + FREQUENCY_MARGIN : inner - FREQUENCY_MARGIN,
    placement.centerY + (below ? offset : -offset),
    mark.frequency,
    {
      face: 'sans400',
      sizePx: FREQUENCY_FONT_SIZE,
      weight: 700,
      fill: markColor(mark, palette) ?? palette.foreground,
      anchor: east ? 'start' : 'end',
      halo: palette.background,
    }
  );
}
