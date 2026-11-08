/** Pin markers, net badges and external port tags as native SVG, mirroring PinMarker, NetBadgeView and BoundaryNode. */

import type { NetCategory } from '../../domain/systemGraph';
import type { BoundaryNodeData } from '../../webview/systemDiagram/layout/diagramTypes';
import type { NetBadge } from '../../webview/systemDiagram/layout/netBadges';
import { BOUNDARY_HEIGHT } from '../../webview/systemDiagram/layout/elkLayout';
import { CIRCLE_MARKER, SQUARE_MARKER } from '../../webview/systemDiagram/layout/pinRows';
import { portShapePath } from '../../webview/systemDiagram/layout/portShape';
import type { Palette } from './palette';
import { element } from './svg';
import { drawText } from './textSvg';

const HOLLOW_STROKE = 1.5;

export interface MarkerSpec {
  isInterface: boolean;
  category?: NetCategory;
  /** A pin with no nets: node-colored fill, colored outline. */
  hollow?: boolean;
}

/** A pin marker centred on `(cx, cy)`: an 8 px square for an interface, a 6 px circle for a signal. */
export function markerSvg(cx: number, cy: number, spec: MarkerSpec, palette: Palette): string {
  const size = spec.isInterface ? SQUARE_MARKER : CIRCLE_MARKER;
  const color = palette.category[spec.category ?? 'signal'];
  // A CSS border sits inside the box, so the hollow outline is inset by half its width.
  const inset = spec.hollow ? HOLLOW_STROKE / 2 : 0;
  const paint = spec.hollow
    ? { fill: palette.background, stroke: color, 'stroke-width': HOLLOW_STROKE }
    : { fill: color };
  if (spec.isInterface) {
    return element('rect', {
      x: cx - size / 2 + inset,
      y: cy - size / 2 + inset,
      width: size - 2 * inset,
      height: size - 2 * inset,
      rx: 1,
      ...paint,
    });
  }
  return element('circle', { cx, cy, r: size / 2 - inset, ...paint });
}

const BADGE_STUB_WIDTH = 8;
const BADGE_STUB_HEIGHT = 2;
const BADGE_GAP = 4;
const BADGE_FONT_SIZE = 10;

/** A clock or reset net label: an 8x2 color stub on the node side of the text, in the badge box. */
export function badgeSvg(badge: NetBadge, palette: Palette): string {
  const west = badge.x < 0;
  const cy = badge.y + badge.height / 2;
  const stubX = west ? badge.x + badge.width - BADGE_STUB_WIDTH : badge.x;
  const textX = west ? stubX - BADGE_GAP : badge.x + BADGE_STUB_WIDTH + BADGE_GAP;
  return [
    element('rect', {
      x: stubX,
      y: cy - BADGE_STUB_HEIGHT / 2,
      width: BADGE_STUB_WIDTH,
      height: BADGE_STUB_HEIGHT,
      rx: 1,
      fill: palette.category[badge.category],
    }),
    drawText(textX, cy, badge.text, {
      face: 'sans400',
      sizePx: BADGE_FONT_SIZE,
      fill: palette.descriptionForeground,
      anchor: west ? 'end' : 'start',
    }),
  ].join('');
}

/** An external port: a pointed tag with its marker centred on the border it connects from. */
export function boundarySvg(data: BoundaryNodeData, palette: Palette): string {
  const east = data.side === 'east';
  const cy = BOUNDARY_HEIGHT / 2;
  return [
    element('path', {
      d: portShapePath(data.width, BOUNDARY_HEIGHT, data.pin.direction === 'inout'),
      fill: palette.nodeHeadFill,
      stroke: palette.nodeLine.color,
      'stroke-opacity': palette.nodeLine.opacity,
      'stroke-width': 1,
    }),
    markerSvg(
      east ? data.width : 0,
      cy,
      { isInterface: data.pin.isInterface, category: data.category },
      palette
    ),
    drawText(12, cy, data.label, {
      face: 'sans600',
      sizePx: 11.5,
      fill: palette.foreground,
    }),
    data.badge ? badgeSvg(data.badge, palette) : '',
  ].join('');
}
