/**
 * Draws one level of a system design, as the system viewer shows it, to image bytes. Shared by
 * `ipcraft render` and the viewer's Export image: both pass the same resolved request, so an
 * exported image equals the CLI's for the same design and options.
 */

import type { SystemGraph } from '../../domain/systemGraph';
import { paletteFor } from '../../shared/render/palette';
import { plexTextMeasure } from '../../shared/render/textMetrics';
import { renderSystemLevelSvg } from '../../shared/render/systemLevelSvg';
import { analyzeClocks } from '../../webview/systemDiagram/clocks/analyzeClocks';
import { applyClockDecor, clockDecor } from '../../webview/systemDiagram/clockDecor';
import { hopDistances, isolationSubset, maxRadius } from '../../webview/systemDiagram/isolation';
import { buildElkInput, toFlowElements } from '../../webview/systemDiagram/layout/elkLayout';
import type { IsolationSubset } from '../../webview/systemDiagram/layout/elkLayout';
import { runElkLayout } from '../../webview/systemDiagram/layout/runElkLayout';
import { isLevelNode } from '../../webview/systemDiagram/model';
import { closestNames } from './closestNames';
import {
  encodeImage,
  type ImageEncoding,
  type RenderLook,
  type RenderRoots,
} from './imageEncoding';
import type { RenderAssets } from './renderResources';

/** A system level to draw, with every name already resolved to a graph path or node id. */
export interface SystemLevelRequest {
  level: string;
  /** Hierarchy blocks drawn expanded, by instance path. */
  expanded: readonly string[];
  /** Isolated view: the selected nodes and the radius (clamped to the selection's reach). */
  isolate?: { nodeIds: readonly string[]; hops: number };
  /** Nodes drawn with the selection outline. */
  selectedNodeIds: readonly string[];
  /** Draw the Clocks and resets domain decorations. */
  clocks: boolean;
  /** Crop the image to these nodes (and the renderer's margin); absent: the whole drawing. */
  cropNodeIds?: readonly string[];
}

/** The viewer's isolation of `nodeIds` at `hops`, clamped to what the selection reaches like the + button. */
export function isolateNodes(
  graph: SystemGraph,
  level: string,
  nodeIds: readonly string[],
  hops: number
): IsolationSubset {
  const distances = hopDistances(graph, level, nodeIds);
  return isolationSubset(graph, level, nodeIds, Math.min(hops, maxRadius(distances)), distances);
}

/** Throws unless `graph` has `level`, naming the closest levels. */
export function requireLevel(graph: SystemGraph, level: string): void {
  if (!graph.levels[level]) {
    const close = closestNames(level, Object.keys(graph.levels));
    throw new Error(`Unknown level '${level}'. Closest: ${close.join(', ')}`);
  }
}

/** The level of `graph` drawn as SVG text; `fontFaceCss` comes from the shared assets. */
async function drawSystemLevel(
  graph: SystemGraph,
  request: SystemLevelRequest,
  look: RenderLook,
  fontFaceCss: string
): Promise<string> {
  const { level } = request;
  requireLevel(graph, level);
  const stale = request.isolate?.nodeIds.find((id) => !isLevelNode(graph, level, id));
  if (stale !== undefined) {
    throw new Error(`'${stale}' is not a block or port of level '${level}'`);
  }
  const expanded = new Set(request.expanded);
  const isolation =
    request.isolate && request.isolate.nodeIds.length > 0
      ? isolateNodes(graph, level, request.isolate.nodeIds, request.isolate.hops)
      : undefined;
  const input = buildElkInput(graph, level, {
    measure: plexTextMeasure,
    expanded,
    ...(isolation && { isolate: isolation }),
  });
  const laidOut = await runElkLayout(input);
  const flow = toFlowElements(laidOut, graph, level, plexTextMeasure);
  const decor = request.clocks
    ? clockDecor(
        flow,
        { graph, analysis: analyzeClocks(graph), levelPath: level, domainMode: true },
        null
      )
    : undefined;
  const layout = decor ? applyClockDecor(flow, decor) : flow;
  return renderSystemLevelSvg(layout, {
    selectedNodeIds: new Set(request.selectedNodeIds),
    cropNodeIds: request.cropNodeIds && new Set(request.cropNodeIds),
    domainLegend: decor?.legend,
    palette: paletteFor(look.theme),
    grid: look.grid,
    legend: look.legend,
    background: look.background,
    fontFaceCss,
  });
}

/** The bytes of the image file of a system level. */
export async function renderSystemLevelImage(
  graph: SystemGraph,
  request: SystemLevelRequest,
  look: RenderLook,
  encoding: ImageEncoding,
  assets: RenderAssets,
  roots: Pick<RenderRoots, 'fontsDir' | 'resvgWasmPath'>
): Promise<Uint8Array> {
  const { css } = await assets.fontsFrom(roots.fontsDir);
  const svg = await drawSystemLevel(graph, request, look, css);
  return encodeImage(svg, encoding, look.theme, assets, roots);
}
