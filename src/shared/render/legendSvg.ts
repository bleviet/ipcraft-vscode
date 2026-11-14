/** The wire-category legend as native SVG, mirroring DiagramLegend: color bars with labels in a bordered panel. */

import type {
  DiagramFlowEdge,
  DiagramFlowNode,
} from '../../webview/systemDiagram/layout/elkLayout';
import { nodeBadges } from '../../webview/systemDiagram/layout/diagramBounds';
import type { ChangeLegend } from '../../webview/systemDiagram/changeDecor';
import type { MarkStatus } from '../../webview/systemDiagram/changeMarks';
import {
  changeLegendEntries,
  legendEntries,
  type DomainLegendEntry,
} from '../../webview/systemDiagram/legend';
import type { NetCategory } from '../../domain/systemGraph';
import { dottedDash, REMOVED_WIRE_DASH } from './changeSvg';
import { resolveColor, type Palette } from './palette';
import { element, num } from './svg';
import { measureText } from './textMetrics';
import { drawText } from './textSvg';

const PADDING_X = 10;
const PADDING_Y = 6;
const ITEM_GAP_X = 12;
const ITEM_GAP_Y = 4;
const ITEM_HEIGHT = 16;
const BAR_WIDTH = 16;
const BAR_GAP = 5;
const FONT_SIZE = 11;
/** `.sd-legend-swatch`: the box of a kind of change, 12 x 8 with a 1.5 px border. */
const SWATCH_WIDTH = 12;
const SWATCH_HEIGHT = 8;
const SWATCH_BORDER = 1.5;
const SIGN_FONT_SIZE = 12;
/** `.sd-legend-swatch[data-change='removed']`: a dashed border. */
const REMOVED_SWATCH_DASH = '3 2';
/** The stroke width of a dashed bar (a domain's dashed line, the removed wire). */
const DASHED_BAR_WIDTH = 2;
/** `.sd-legend-bar-new`. */
const NEW_WIRE_BAR_HEIGHT = 3.75;

/** What a legend entry of the marks of a comparison draws in place of the wire bar. */
export type LegendChange =
  | { kind: 'status'; status: MarkStatus; sign: string }
  | { kind: 'newWire' }
  | { kind: 'removedWire' }
  | { kind: 'removed' };

export interface LegendLayout {
  width: number;
  height: number;
  /** Items in reading order, positioned inside the panel. */
  items: {
    x: number;
    y: number;
    label: string;
    thick: boolean;
    /** The bar color: a wire category, or a domain entry's own color (a CSS token, see `resolveColor`). */
    category?: NetCategory;
    color?: string;
    dashed?: boolean;
    change?: LegendChange;
    /** Distance from `x` to the label: the bar (or swatch and sign) and its gap. */
    labelOffset: number;
  }[];
}

/**
 * The entries of the marks of a comparison: the kinds of change, the new wire, the removed wire,
 * and the count of removed blocks unless the ghosts are drawn (the kind `removed` is an entry then).
 */
function changeEntries(changes: ChangeLegend | undefined) {
  if (!changes) {
    return [];
  }
  return [
    ...changeLegendEntries(changes.kinds).map((entry) => ({
      label: entry.label,
      thick: false,
      change: { kind: 'status', status: entry.status, sign: entry.sign } as const,
    })),
    ...(changes.newWire
      ? [{ label: 'New wire', thick: false, change: { kind: 'newWire' } as const }]
      : []),
    ...(changes.removedWire
      ? [{ label: 'Removed wire', thick: false, change: { kind: 'removedWire' } as const }]
      : []),
    ...(changes.removed > 0 && !changes.kinds.includes('removed')
      ? [
          {
            label: `− ${changes.removed} removed`,
            thick: false,
            change: { kind: 'removed' } as const,
          },
        ]
      : []),
  ];
}

/** Distance from an entry's left edge to its label: a status swatch, its sign and gaps; a bar; nothing for the count of removed blocks. */
function labelOffsetOf(change: LegendChange | undefined): number {
  if (change?.kind === 'removed') {
    return 0;
  }
  if (change?.kind === 'status') {
    return SWATCH_WIDTH + BAR_GAP + measureText(change.sign, 'sans600', SIGN_FONT_SIZE) + BAR_GAP;
  }
  return BAR_WIDTH + BAR_GAP;
}

/** Lays the legend entries of the drawn level out in rows that wrap at `maxWidth`; null when there are none. */
export function layoutLegend(
  layout: { nodes: readonly DiagramFlowNode[]; edges: readonly DiagramFlowEdge[] },
  maxWidth: number,
  domains: readonly DomainLegendEntry[] = [],
  changes?: ChangeLegend
): LegendLayout | null {
  const entries: Omit<LegendLayout['items'][number], 'x' | 'y' | 'labelOffset'>[] = [
    ...legendEntries(
      layout.edges.map((edge) => edge.data),
      layout.nodes.flatMap((node) => nodeBadges(node).flatMap((badge) => badge.nets))
    ),
    ...domains.map((entry) => ({
      label: entry.label,
      thick: false,
      color: entry.color,
      dashed: entry.line === 'dashed',
    })),
    ...changeEntries(changes),
  ];
  if (entries.length === 0) {
    return null;
  }
  const inner = Math.max(0, maxWidth - 2 * PADDING_X - 2);
  const items: LegendLayout['items'] = [];
  let x = 0;
  let row = 0;
  let widest = 0;
  for (const entry of entries) {
    const labelOffset = labelOffsetOf(entry.change);
    const width = labelOffset + measureText(entry.label, 'sans400', FONT_SIZE);
    if (x > 0 && x + width > inner) {
      x = 0;
      row += 1;
    }
    items.push({
      x: 1 + PADDING_X + x,
      y: 1 + PADDING_Y + row * (ITEM_HEIGHT + ITEM_GAP_Y),
      label: entry.label,
      thick: entry.thick,
      category: entry.category,
      color: entry.color,
      dashed: entry.dashed,
      change: entry.change,
      labelOffset,
    });
    widest = Math.max(widest, x + width);
    x += width + ITEM_GAP_X;
  }
  return {
    width: widest + 2 * PADDING_X + 2,
    height: (row + 1) * ITEM_HEIGHT + row * ITEM_GAP_Y + 2 * PADDING_Y + 2,
    items,
  };
}

/** A round-ended color bar of the legend. */
function barSvg(x: number, centerY: number, height: number, color: string): string {
  return element('rect', {
    x,
    y: centerY - height / 2,
    width: BAR_WIDTH,
    height,
    rx: height / 2,
    fill: color,
  });
}

/** What leads an entry: the swatch and sign of a kind of change, a wire bar, a dashed bar for the removed wire, or nothing for the removed count. */
function itemMarkSvg(item: LegendLayout['items'][number], palette: Palette): string {
  const cy = item.y + ITEM_HEIGHT / 2;
  const { change } = item;
  if (change?.kind === 'removed') {
    return '';
  }
  if (change?.kind === 'newWire') {
    return barSvg(item.x, cy, NEW_WIRE_BAR_HEIGHT, palette.change.newWire);
  }
  if (change?.kind === 'removedWire') {
    return element('line', {
      x1: item.x,
      y1: cy,
      x2: item.x + BAR_WIDTH,
      y2: cy,
      stroke: palette.change.removed,
      'stroke-width': DASHED_BAR_WIDTH,
      'stroke-dasharray': REMOVED_WIRE_DASH,
    });
  }
  if (change?.kind === 'status') {
    const color = palette.change[change.status];
    return [
      element('rect', {
        x: item.x + SWATCH_BORDER / 2,
        y: cy - SWATCH_HEIGHT / 2 + SWATCH_BORDER / 2,
        width: SWATCH_WIDTH - SWATCH_BORDER,
        height: SWATCH_HEIGHT - SWATCH_BORDER,
        rx: 1.5,
        fill: 'none',
        stroke: color,
        'stroke-width': SWATCH_BORDER,
        'stroke-dasharray':
          change.status === 'version'
            ? dottedDash(SWATCH_BORDER)
            : change.status === 'removed'
              ? REMOVED_SWATCH_DASH
              : undefined,
      }),
      drawText(item.x + SWATCH_WIDTH + BAR_GAP, cy, change.sign, {
        face: 'sans600',
        sizePx: SIGN_FONT_SIZE,
        fill: color,
      }),
    ].join('');
  }
  const color =
    item.color === undefined
      ? palette.category[item.category ?? 'signal']
      : resolveColor(palette, item.color);
  return item.dashed
    ? element('line', {
        x1: item.x,
        y1: cy,
        x2: item.x + BAR_WIDTH,
        y2: cy,
        stroke: color,
        'stroke-width': DASHED_BAR_WIDTH,
        'stroke-dasharray': '6 4',
      })
    : barSvg(item.x, cy, item.thick ? 3 : 1.5, color);
}

/** The legend panel with its top-left corner at `(x, y)`. */
export function legendSvg(legend: LegendLayout, x: number, y: number, palette: Palette): string {
  const parts = [
    element('rect', {
      x: 0.5,
      y: 0.5,
      width: legend.width - 1,
      height: legend.height - 1,
      rx: 3.5,
      fill: palette.widgetBackground,
      stroke: palette.widgetBorder,
    }),
  ];
  for (const item of legend.items) {
    parts.push(
      itemMarkSvg(item, palette),
      drawText(item.x + item.labelOffset, item.y + ITEM_HEIGHT / 2, item.label, {
        face: 'sans400',
        sizePx: FONT_SIZE,
        fill: palette.descriptionForeground,
      })
    );
  }
  return `<g data-legend="true" transform="translate(${num(x)} ${num(y)})">${parts.join('')}</g>`;
}
