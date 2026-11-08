/** Instance blocks and expanded hierarchy frames as native SVG, mirroring InstanceNode, FrameNode and NodeHeader. */

import type { SystemInstance } from '../../domain/systemGraph';
import type {
  FrameNodeData,
  InstanceNodeData,
  PinRow,
} from '../../webview/systemDiagram/layout/diagramTypes';
import { HEADER_HEIGHT, PIN_ROW_HEIGHT } from '../../webview/systemDiagram/layout/pinRows';
import { instanceSubtitle } from '../../webview/systemDiagram/model';
import type { Palette } from './palette';
import { badgeSvg, markerSvg } from './pinSvg';
import { element } from './svg';
import { truncateEnd, WEIGHT_FACES } from './textMetrics';
import { drawText } from './textSvg';

const NODE_BORDER = 1;
const FRAME_BORDER = 2;
const HEADER_PADDING_X = 8;
const TOGGLE_SIZE = 16;
const TOGGLE_GAP = 6;
/** Title line is 16 px tall at the top of the header padding; the subtitle line is 14 px below it. */
const TITLE_CENTER = 8;
const SUBTITLE_CENTER = 16 + 7;
const HEADER_PADDING_Y = 3;
/** Pin label inset from its border, inside the 1 px border (9 px) or frame (10 px). */
const ROW_TEXT_INSET = 9;
const FRAME_LABEL_INSET = 12;
/** Frame pin labels sit in a 14 px line ending 2 px above the pin height: its centre is 9 px above. */
const FRAME_LABEL_CENTER_ABOVE_PIN = 9;

interface BlockBox {
  width: number;
  /** Border thickness: 1 for a block, 2 for a frame. */
  border: number;
  /** Corner radius of the header band's top corners. */
  headRadius: number;
}

/** The header band: fill, rounded top corners, and the 1 px line under it. */
function headerBand(box: BlockBox, palette: Palette): string {
  const { width, border, headRadius: r } = box;
  const left = border;
  const right = width - border;
  const bottom = border + HEADER_HEIGHT;
  return [
    element('path', {
      d: `M${left},${bottom} V${border + r} a${r},${r} 0 0 1 ${r},${-r} H${right - r} a${r},${r} 0 0 1 ${r},${r} V${bottom} Z`,
      fill: palette.nodeHeadFill,
    }),
    element('line', {
      x1: left,
      y1: bottom - 0.5,
      x2: right,
      y2: bottom - 0.5,
      stroke: palette.nodeLine.color,
      'stroke-opacity': palette.nodeLine.opacity,
    }),
  ].join('');
}

/** The boxed [+] / [-] button of a hierarchy block header. */
function toggleSvg(x: number, centerY: number, expanded: boolean, palette: Palette): string {
  const half = 4;
  const cx = x + TOGGLE_SIZE / 2;
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    element('line', { x1, y1, x2, y2, stroke: palette.foreground, 'stroke-width': 1.2 });
  return [
    element('rect', {
      x: x + 0.5,
      y: centerY - TOGGLE_SIZE / 2 + 0.5,
      width: TOGGLE_SIZE - 1,
      height: TOGGLE_SIZE - 1,
      rx: 2.5,
      fill: 'none',
      stroke: palette.nodeLine.color,
      'stroke-opacity': palette.nodeLine.opacity,
    }),
    line(cx - half, centerY, cx + half, centerY),
    expanded ? '' : line(cx, centerY - half, cx, centerY + half),
  ].join('');
}

/** Title (with the expand toggle of a hierarchy block) and subtitle of the header. */
function headerText(
  instance: SystemInstance,
  cellCount: number,
  box: BlockBox,
  expanded: boolean,
  palette: Palette
): string {
  const top = box.border + HEADER_PADDING_Y;
  const left = box.border + HEADER_PADDING_X;
  const isHier = instance.kind === 'hier';
  const nameX = left + (isHier ? TOGGLE_SIZE + TOGGLE_GAP : 0);
  const textWidth = box.width - 2 * (box.border + HEADER_PADDING_X);
  const subtitle = instanceSubtitle(instance, cellCount);
  return [
    isHier ? toggleSvg(left, top + TITLE_CENTER, expanded, palette) : '',
    drawText(
      nameX,
      top + TITLE_CENTER,
      truncateEnd(instance.name, textWidth - (nameX - left), WEIGHT_FACES.semibold),
      { ...WEIGHT_FACES.semibold, fill: palette.foreground }
    ),
    subtitle === ''
      ? ''
      : drawText(
          left,
          top + SUBTITLE_CENTER,
          truncateEnd(subtitle, textWidth, WEIGHT_FACES.subtitle),
          { ...WEIGHT_FACES.subtitle, fill: palette.descriptionForeground }
        ),
  ].join('');
}

function pinLabel(
  x: number,
  centerY: number,
  row: PinRow,
  east: boolean,
  palette: Palette
): string {
  return drawText(x, centerY, row.label, {
    ...WEIGHT_FACES.normal,
    fill: row.unconnected ? palette.descriptionForeground : palette.foreground,
    italic: row.unconnected,
    anchor: east ? 'end' : 'start',
  });
}

/** An instance block, drawn in its own coordinates (origin at the node's top-left). */
export function instanceSvg(data: InstanceNodeData, height: number, palette: Palette): string {
  const { width } = data;
  const box: BlockBox = { width, border: NODE_BORDER, headRadius: 3 };
  const parts = [
    element('rect', {
      x: 0.5,
      y: 0.5,
      width: width - 1,
      height: height - 1,
      rx: 3.5,
      fill: palette.nodeFill,
      stroke: palette.nodeLine.color,
      'stroke-opacity': palette.nodeLine.opacity,
    }),
    headerBand(box, palette),
    headerText(data.instance, data.cellCount, box, false, palette),
  ];
  if (data.instance.kind === 'hier') {
    parts.push(
      element('rect', {
        x: 4.5,
        y: 4.5,
        width: width - 9,
        height: height - 9,
        rx: 1.5,
        fill: 'none',
        stroke: palette.nodeLine.color,
        'stroke-opacity': palette.nodeLine.opacity,
        'stroke-dasharray': '3 3',
      })
    );
  }
  for (const [rows, east] of [
    [data.west, false],
    [data.east, true],
  ] as const) {
    rows.forEach((row, index) => {
      const cy = NODE_BORDER + HEADER_HEIGHT + index * PIN_ROW_HEIGHT + PIN_ROW_HEIGHT / 2;
      parts.push(
        markerSvg(east ? width : 0, cy, { ...row, hollow: row.unconnected }, palette),
        pinLabel(
          east ? width - ROW_TEXT_INSET - NODE_BORDER : NODE_BORDER + ROW_TEXT_INSET,
          cy,
          row,
          east,
          palette
        )
      );
      if (row.badge) {
        parts.push(badgeSvg(row.badge, palette));
      }
    });
  }
  return parts.join('');
}

/** An expanded hierarchy block: a frame with the header on top and its pins on the border. */
export function frameSvg(
  data: FrameNodeData,
  size: { width: number; height: number },
  palette: Palette
): string {
  const { width, height } = size;
  const box: BlockBox = { width, border: FRAME_BORDER, headRadius: 4 };
  const parts = [
    element('rect', {
      x: 1,
      y: 1,
      width: width - 2,
      height: height - 2,
      rx: 5,
      fill: palette.frameFill.color,
      'fill-opacity': palette.frameFill.opacity,
      stroke: palette.nodeLine.color,
      'stroke-opacity': palette.nodeLine.opacity,
      'stroke-width': FRAME_BORDER,
    }),
    headerBand(box, palette),
    headerText(data.instance, data.cellCount, box, true, palette),
  ];
  for (const [rows, east] of [
    [data.west, false],
    [data.east, true],
  ] as const) {
    for (const row of rows) {
      parts.push(
        markerSvg(east ? width : 0, row.y, { ...row, hollow: row.unconnected }, palette),
        pinLabel(
          east ? width - FRAME_LABEL_INSET : FRAME_LABEL_INSET,
          row.y - FRAME_LABEL_CENTER_ABOVE_PIN,
          row,
          east,
          palette
        )
      );
      if (row.badge) {
        parts.push(badgeSvg(row.badge, palette));
      }
    }
  }
  return parts.join('');
}
