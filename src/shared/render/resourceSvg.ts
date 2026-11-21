/**
 * What the Resources toggle adds to a block, as native SVG: the strip of figures above it. Mirrors
 * `.sd-node-usage` of systemDiagram.css; the text is the canvas's (resourceView.ts `nodeResources`),
 * not a copy.
 */

import type { ResourceReport } from '../../domain/resourceUsage';
import type { DiagramFlowNode } from '../../webview/systemDiagram/layout/elkLayout';
import { nodeResources } from '../../webview/systemDiagram/resources/resourceView';
import { isGhost } from './changeSvg';
import type { Palette } from './palette';
import { element } from './svg';
import { measureText, WEIGHT_FACES } from './textMetrics';
import { drawText } from './textSvg';

/** The usage to draw: the report mapped onto the design. */
export interface ResourceRender {
  report: ResourceReport;
}

/** `.sd-node-usage`: 14 px lines (the counts, then the shares) with 4 px of padding on each side, above the block. */
export const STRIP_HEIGHT = 14;
/** The space between the strip and the outer edge of the block's border, so neither the border nor a selection ring is covered. */
export const STRIP_GAP = 2;
const STRIP_PADDING = 4;
/** The strip's background is the editor background at 80 %. */
const STRIP_OPACITY = 0.8;
/** The strip is set in IBM Plex Mono at the pin label size. */
const STRIP_SIZE = WEIGHT_FACES.normal.sizePx;

/** The strip above `node`; undefined for a port, a ghost, and a block the report says nothing about. */
export function blockStrip(
  node: DiagramFlowNode,
  resources: ResourceRender
): { lines: string[]; muted: boolean } | undefined {
  if (node.type === 'boundary' || isGhost(node.data.change)) {
    return undefined;
  }
  const shown = nodeResources(resources.report, node.id);
  return (
    shown && {
      lines: [shown.strip, ...(shown.shares === undefined ? [] : [shown.shares])],
      muted: shown.notInReport,
    }
  );
}

/** The widest of the lines, plus the padding. */
const stripWidth = (lines: readonly string[]): number =>
  Math.max(...lines.map((line) => measureText(line, 'mono400', STRIP_SIZE))) + 2 * STRIP_PADDING;

/** The box of a block's strip in layout coordinates: it ends {@link STRIP_GAP} above the block and grows upwards. */
export function stripBox(node: DiagramFlowNode, lines: readonly string[]) {
  const height = lines.length * STRIP_HEIGHT;
  return {
    x: node.position.x,
    y: node.position.y - STRIP_GAP - height,
    width: stripWidth(lines),
    height,
  };
}

/** The strip in the block's own coordinates (origin at its top-left): one background, one text per line, the counts on top. */
export function stripSvg(strip: { lines: string[]; muted: boolean }, palette: Palette): string {
  const height = strip.lines.length * STRIP_HEIGHT;
  return [
    element('rect', {
      x: 0,
      y: -STRIP_GAP - height,
      width: stripWidth(strip.lines),
      height,
      rx: 2,
      fill: palette.background,
      'fill-opacity': STRIP_OPACITY,
    }),
    ...strip.lines.map((line, index) =>
      drawText(STRIP_PADDING, -STRIP_GAP - height + (index + 0.5) * STRIP_HEIGHT, line, {
        face: 'mono400',
        sizePx: STRIP_SIZE,
        fill: strip.muted ? palette.descriptionForeground : palette.foreground,
        italic: strip.muted,
      })
    ),
  ].join('');
}
