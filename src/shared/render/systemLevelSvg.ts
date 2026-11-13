/**
 * Draws one laid-out system level as a standalone SVG. Pure and Node-safe: it takes the nodes and
 * edges `toFlowElements` builds and writes native SVG elements, with no DOM, React, CSS classes
 * or `var()` colors, so the file opens in Inkscape, LibreOffice and Word. Output is deterministic.
 *
 * Mirrors the webview's InstanceNode, FrameNode, BoundaryNode, ElkEdge and DiagramLegend (their
 * styles live in systemDiagram.css; the colors in palette.ts). Deliberate simplifications:
 * - no node shadow, user highlight colors, search dimming, review or selected clock tree;
 *   the selection outline (`selectedNodeIds`) and the Clocks and resets domain decorations
 *   (already merged into the layout by `applyClockDecor`, plus `domainLegend`) and the marks of a
 *   comparison (`changes`, merged into the nodes and wires here, as the canvas does) are drawn;
 * - the signs of a comparison are drawn at weight 600: no 700 face is embedded, the canvas uses 700;
 * - the legend sits below the drawing instead of floating over the canvas corner;
 * - grid dots are 1.5 px across (the canvas draws 1 px) so they survive printing;
 * - an unconnected pin label is italic through the browser's synthesized slant (no italic face);
 * - frame pin markers sit on the ELK port height, so they meet the wire ends exactly.
 */

import type { ChangeDecor } from '../../webview/systemDiagram/changeDecor';
import type { DomainLegendEntry } from '../../webview/systemDiagram/legend';
import type {
  DiagramFlowEdge,
  DiagramFlowNode,
} from '../../webview/systemDiagram/layout/elkLayout';
import { JUNCTION_RADIUS } from '../../webview/systemDiagram/layout/diagramTypes';
import { diagramBounds, nodeBounds } from '../../webview/systemDiagram/layout/diagramBounds';
import { frameSvg, instanceSvg } from './blockSvg';
import { layoutLegend, legendSvg } from './legendSvg';
import type { Palette } from './palette';
import { boundarySvg } from './pinSvg';
import { attributes, element, num, SVG_TEXT_STYLE } from './svg';

export interface SystemLevelOptions {
  palette: Palette;
  grid: boolean;
  legend: boolean;
  background: 'editor' | 'transparent';
  /** `@font-face` rules for the `<style>` element; see fontFaces.ts. */
  fontFaceCss: string;
  /** Blocks and ports drawn with the selection outline (the viewer's selected style). */
  selectedNodeIds?: ReadonlySet<string>;
  /** Crop to these nodes (their boxes and badges) plus the margin; absent or matching none: the whole drawing. */
  cropNodeIds?: ReadonlySet<string>;
  /** Domain entries appended to the legend (see `clockDecor`); null or absent outside the domain mode. */
  domainLegend?: readonly DomainLegendEntry[] | null;
  /** The marks of a comparison on this layout (see `changeDecor`); absent: none are drawn. */
  changes?: ChangeDecor;
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
/** ElkEdge: a crossing is dashed `6 4`; a dimmed wire keeps the full color at this opacity. */
const CROSSING_DASH = '6 4';
const DIMMED_OPACITY = 0.2;
/** ElkEdge: a new wire is this much wider than it would be. */
const NEW_WIRE_WIDTH = 0.75;

function edgeSvg(edge: DiagramFlowEdge, palette: Palette): string {
  const d = edge.data.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${num(point.x)} ${num(point.y)}`)
    .join(' ');
  const { crossing, dimmed, category, changeNew } = edge.data;
  const plainStroke = crossing
    ? palette.warning
    : dimmed
      ? palette.category[category]
      : palette.wire[category];
  // ElkEdge `markedStroke`: a new wire takes the added color unless a crossing or a domain color says something already.
  const stroke =
    changeNew && !crossing && edge.data.domainColor === undefined
      ? palette.change.newWire
      : plainStroke;
  const opacity = dimmed && !crossing ? DIMMED_OPACITY : undefined;
  const wire = element('path', {
    d,
    fill: 'none',
    stroke,
    'stroke-width':
      (edge.data.isInterface ? INTERFACE_WIDTH : SIGNAL_WIDTH) + (changeNew ? NEW_WIRE_WIDTH : 0),
    'stroke-dasharray': crossing ? CROSSING_DASH : undefined,
    opacity,
  });
  // A junction dot marks where a branch leaves its net's tree (ElkEdge draws the same).
  return edge.data.junction
    ? wire +
        element('circle', {
          cx: num(edge.data.points[0].x),
          cy: num(edge.data.points[0].y),
          r: JUNCTION_RADIUS,
          fill: stroke,
          opacity,
        })
    : wire;
}

function nodeSvg(node: DiagramFlowNode, palette: Palette, selected: boolean): string {
  const inner =
    node.type === 'instance'
      ? instanceSvg(node.data, node.height, palette, selected)
      : node.type === 'frame'
        ? frameSvg(node.data, node, palette, selected)
        : boundarySvg(node.data, palette, selected);
  const attrs = attributes({
    'data-node': node.id,
    'data-kind': node.type,
    'data-selected': selected ? 'true' : undefined,
    transform: `translate(${num(node.position.x)} ${num(node.position.y)})`,
  });
  return `<g ${attrs}>${inner}</g>`;
}

/** `layout` with the marks of `decor` in the data of its nodes and wires, where the canvas puts them. */
function withChanges(layout: SystemLevelLayout, decor: ChangeDecor): SystemLevelLayout {
  return {
    nodes: layout.nodes.map((node) => {
      const change = decor.nodes.get(node.id);
      return change ? ({ ...node, data: { ...node.data, change } } as DiagramFlowNode) : node;
    }),
    edges: layout.edges.map((edge) =>
      decor.newEdgeIds.has(edge.id)
        ? { ...edge, data: { ...edge.data, changeNew: true as const } }
        : edge
    ),
  };
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

/** The union of the boxes of the nodes named in `ids`, or null when none is in the layout. */
function cropBounds(layout: SystemLevelLayout, ids: ReadonlySet<string>) {
  const nodes = layout.nodes.filter((node) => ids.has(node.id));
  if (nodes.length === 0) {
    return null;
  }
  const boxes = nodes.map(nodeBounds);
  const x = Math.min(...boxes.map((box) => box.x));
  const y = Math.min(...boxes.map((box) => box.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y,
  };
}

export function renderSystemLevelSvg(
  plainLayout: SystemLevelLayout,
  options: SystemLevelOptions
): string {
  const { palette } = options;
  const layout = options.changes ? withChanges(plainLayout, options.changes) : plainLayout;
  const content = (options.cropNodeIds && cropBounds(layout, options.cropNodeIds)) ??
    diagramBounds(layout) ?? { x: 0, y: 0, ...EMPTY_SIZE };
  const legend = options.legend
    ? layoutLegend(
        layout,
        Math.max(content.width, MIN_LEGEND_WIDTH),
        options.domainLegend ?? [],
        options.changes?.legend
      )
    : null;
  const drawNode = (node: DiagramFlowNode) =>
    nodeSvg(node, palette, options.selectedNodeIds?.has(node.id) ?? false);
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
    ...frames.map(drawNode),
    ...layout.edges.map((edge) => edgeSvg(edge, palette)),
    ...blocks.map(drawNode),
    legend ? legendSvg(legend, content.x, content.y + content.height + LEGEND_GAP, palette) : '',
  ];
  const root = attributes({
    xmlns: 'http://www.w3.org/2000/svg',
    width,
    height,
    viewBox: `${num(box.x)} ${num(box.y)} ${width} ${height}`,
    style: SVG_TEXT_STYLE,
  });
  return `<svg ${root}><style>${options.fontFaceCss}</style>${body.join('')}</svg>\n`;
}
