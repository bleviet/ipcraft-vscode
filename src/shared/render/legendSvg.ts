/** The wire-category legend as native SVG, mirroring DiagramLegend: color bars with labels in a bordered panel. */

import type {
  DiagramFlowEdge,
  DiagramFlowNode,
} from '../../webview/systemDiagram/layout/elkLayout';
import { nodeBadges } from '../../webview/systemDiagram/layout/diagramBounds';
import { legendEntries, type DomainLegendEntry } from '../../webview/systemDiagram/legend';
import type { NetCategory } from '../../domain/systemGraph';
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
  }[];
}

/** Lays the legend entries of the drawn level out in rows that wrap at `maxWidth`; null when there are none. */
export function layoutLegend(
  layout: { nodes: readonly DiagramFlowNode[]; edges: readonly DiagramFlowEdge[] },
  maxWidth: number,
  domains: readonly DomainLegendEntry[] = []
): LegendLayout | null {
  const entries: Omit<LegendLayout['items'][number], 'x' | 'y'>[] = [
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
    const width = BAR_WIDTH + BAR_GAP + measureText(entry.label, 'sans400', FONT_SIZE);
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
    const barHeight = item.thick ? 3 : 1.5;
    const color =
      item.color === undefined
        ? palette.category[item.category ?? 'signal']
        : resolveColor(palette, item.color);
    parts.push(
      item.dashed
        ? element('line', {
            x1: item.x,
            y1: item.y + ITEM_HEIGHT / 2,
            x2: item.x + BAR_WIDTH,
            y2: item.y + ITEM_HEIGHT / 2,
            stroke: color,
            'stroke-width': 2,
            'stroke-dasharray': '6 4',
          })
        : element('rect', {
            x: item.x,
            y: item.y + ITEM_HEIGHT / 2 - barHeight / 2,
            width: BAR_WIDTH,
            height: barHeight,
            rx: barHeight / 2,
            fill: color,
          }),
      drawText(item.x + BAR_WIDTH + BAR_GAP, item.y + ITEM_HEIGHT / 2, item.label, {
        face: 'sans400',
        sizePx: FONT_SIZE,
        fill: palette.descriptionForeground,
      })
    );
  }
  return `<g data-legend="true" transform="translate(${num(x)} ${num(y)})">${parts.join('')}</g>`;
}
