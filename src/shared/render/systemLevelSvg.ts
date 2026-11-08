/**
 * Draws one laid-out system level as a standalone SVG. Pure and Node-safe: it takes the nodes and
 * edges `toFlowElements` builds and writes native SVG elements, with no DOM, React, CSS classes
 * or `var()` colors, so the file opens in Inkscape, LibreOffice and Word. Output is deterministic.
 *
 * Mirrors the webview's InstanceNode, FrameNode, BoundaryNode, ElkEdge and DiagramLegend (their
 * styles live in systemDiagram.css; the colors in palette.ts). Deliberate simplifications:
 * - no node shadow, selection, highlight, search dimming, review or clock-domain decoration;
 * - the legend sits below the drawing instead of floating over the canvas corner;
 * - grid dots are 1.5 px across (the canvas draws 1 px) so they survive printing;
 * - an unconnected pin label is italic through the browser's synthesized slant (no italic face);
 * - frame pin markers sit on the ELK port height, so they meet the wire ends exactly.
 */

import type {
  DiagramFlowEdge,
  DiagramFlowNode,
} from '../../webview/systemDiagram/layout/elkLayout';
import { diagramBounds } from '../../webview/systemDiagram/layout/diagramBounds';
import { frameSvg, instanceSvg } from './blockSvg';
import { layoutLegend, legendSvg } from './legendSvg';
import type { Palette } from './palette';
import { boundarySvg } from './pinSvg';
import { attributes, element, num } from './svg';

export interface SystemLevelOptions {
  palette: Palette;
  grid: boolean;
  legend: boolean;
  background: 'editor' | 'transparent';
  /** `@font-face` rules for the `<style>` element; see fontFaces.ts. */
  fontFaceCss: string;
}

export interface SystemLevelLayout {
  nodes: readonly DiagramFlowNode[];
  edges: readonly DiagramFlowEdge[];
}

const MARGIN = 24;
const LEGEND_GAP = 16;
const GRID_GAP = 20;
const GRID_DOT_RADIUS = 0.75;
const MIN_LEGEND_WIDTH = 360;
const EMPTY_SIZE = { width: 200, height: 100 };
const INTERFACE_WIDTH = 1.75;
const SIGNAL_WIDTH = 1;

function edgeSvg(edge: DiagramFlowEdge, palette: Palette): string {
  const d = edge.data.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${num(point.x)} ${num(point.y)}`)
    .join(' ');
  return element('path', {
    d,
    fill: 'none',
    stroke: palette.wire[edge.data.category],
    'stroke-width': edge.data.isInterface ? INTERFACE_WIDTH : SIGNAL_WIDTH,
  });
}

function nodeSvg(node: DiagramFlowNode, palette: Palette): string {
  const inner =
    node.type === 'instance'
      ? instanceSvg(node.data, node.height, palette)
      : node.type === 'frame'
        ? frameSvg(node.data, node, palette)
        : boundarySvg(node.data, palette);
  const attrs = attributes({
    'data-node': node.id,
    'data-kind': node.type,
    transform: `translate(${num(node.position.x)} ${num(node.position.y)})`,
  });
  return `<g ${attrs}>${inner}</g>`;
}

function gridSvg(box: { x: number; y: number; width: number; height: number }, palette: Palette) {
  const { color, opacity } = palette.gridDot;
  return [
    `<defs><pattern id="ipcraft-grid" width="${GRID_GAP}" height="${GRID_GAP}" patternUnits="userSpaceOnUse">`,
    element('circle', {
      cx: 1,
      cy: 1,
      r: GRID_DOT_RADIUS,
      fill: color,
      'fill-opacity': opacity,
    }),
    '</pattern></defs>',
    element('rect', { ...box, fill: 'url(#ipcraft-grid)' }),
  ].join('');
}

export function renderSystemLevelSvg(
  layout: SystemLevelLayout,
  options: SystemLevelOptions
): string {
  const { palette } = options;
  const content = diagramBounds(layout) ?? { x: 0, y: 0, ...EMPTY_SIZE };
  const legend = options.legend
    ? layoutLegend(layout, Math.max(content.width, MIN_LEGEND_WIDTH))
    : null;
  const width = Math.ceil(Math.max(content.width, legend?.width ?? 0) + 2 * MARGIN);
  const legendHeight = legend ? legend.height + LEGEND_GAP : 0;
  const height = Math.ceil(content.height + legendHeight + 2 * MARGIN);
  const box = {
    x: Math.floor(content.x - MARGIN),
    y: Math.floor(content.y - MARGIN),
    width,
    height,
  };

  // A frame sits below the wires and blocks it contains (zIndex -1 in the canvas).
  const frames = layout.nodes.filter((node) => node.type === 'frame');
  const blocks = layout.nodes.filter((node) => node.type !== 'frame');
  const body = [
    options.background === 'editor' ? element('rect', { ...box, fill: palette.background }) : '',
    options.grid ? gridSvg(box, palette) : '',
    ...frames.map((node) => nodeSvg(node, palette)),
    ...layout.edges.map((edge) => edgeSvg(edge, palette)),
    ...blocks.map((node) => nodeSvg(node, palette)),
    legend ? legendSvg(legend, content.x, content.y + content.height + LEGEND_GAP, palette) : '',
  ];
  const root = attributes({
    xmlns: 'http://www.w3.org/2000/svg',
    width,
    height,
    viewBox: `${num(box.x)} ${num(box.y)} ${width} ${height}`,
    style: 'font-kerning:none',
  });
  return `<svg ${root}><style>${options.fontFaceCss}</style>${body.join('')}</svg>\n`;
}
