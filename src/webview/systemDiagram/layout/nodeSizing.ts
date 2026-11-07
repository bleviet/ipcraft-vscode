/**
 * Pure content-based sizing of instance and boundary nodes. Text widths come
 * from an injected measurer so the module stays free of the DOM.
 */

import type { SystemInstance, SystemPin } from '../../../domain/systemGraph';

export type TextWeight = 'normal' | 'semibold' | 'subtitle';
/** Pixel width of `text` at the node font size. */
export type TextMeasure = (text: string, weight: TextWeight) => number;

export const INSTANCE_MIN_WIDTH = 180;
export const INSTANCE_MAX_WIDTH = 420;
export const BOUNDARY_MIN_WIDTH = 100;
export const BOUNDARY_MAX_WIDTH = 320;
const ROW_PADDING = 16;
/** The node's 1 px border on each side takes space from its content box. */
const NODE_BORDER = 2;
const COLUMN_GAP = 16;
/**
 * Horizontal space a pin row spends besides its text: the text sits 10 px from
 * its border (9 px inside the 1 px border) and keeps 9 px on the other side.
 * The pin marker is centred on the border and takes no row space.
 */
const ROW_CHROME = 18;
/** External port tag: text starts 12 px in and stops before the 12 px arrow tip. */
const BOUNDARY_CHROME = 24;
/** Room for the expand toggle (16 px button plus the 6 px title gap) before a hierarchy block's name. */
const HIER_TOGGLE_WIDTH = 22;
/** Least gap between an expanded frame's border and the blocks inside it. */
export const FRAME_MARGIN = 20;
/** Room for the chevron of a folded or open pin array row. */
export const CHEVRON_WIDTH = 14;
const ELLIPSIS = '…';
const START_SHARE = 0.6;

/** A pin row to size: its `name` keys the label; the row shows `text` (default `name`) and `extra` px of chrome. */
export interface SizedRow {
  name: string;
  text?: string;
  extra?: number;
}

export interface InstanceLayout {
  width: number;
  westWidth: number;
  eastWidth: number;
  /** Display text per row name: the full text or its middle-ellipsized form. */
  labels: Map<string, string>;
}

export interface BoundaryLayout {
  width: number;
  label: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function middleCut(chars: readonly string[], kept: number): string {
  const start = Math.max(1, Math.floor(kept * START_SHARE));
  const end = Math.max(1, kept - start);
  return `${chars.slice(0, start).join('')}${ELLIPSIS}${chars.slice(chars.length - end).join('')}`;
}

/**
 * `text` when it fits `maxWidth`; otherwise the longest start and end around
 * one ellipsis (about 60/40 in favour of the start, at least one character
 * each side). Counts code points, so surrogate pairs are never split.
 */
export function middleEllipsis(text: string, maxWidth: number, measure: TextMeasure): string {
  const chars = Array.from(text);
  if (measure(text, 'normal') <= maxWidth || chars.length <= 3) {
    return text;
  }
  let low = 2;
  let high = chars.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(middleCut(chars, mid), 'normal') <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return middleCut(chars, low);
}

function labelFor(row: SizedRow, columnWidth: number, measure: TextMeasure): string {
  return middleEllipsis(row.text ?? row.name, columnWidth - ROW_CHROME - (row.extra ?? 0), measure);
}

function naturalColumn(rows: readonly SizedRow[], measure: TextMeasure): number {
  if (rows.length === 0) {
    return 0;
  }
  return (
    ROW_CHROME +
    Math.max(...rows.map((row) => measure(row.text ?? row.name, 'normal') + (row.extra ?? 0)))
  );
}

/** Splits `width` between the sides: natural widths when they fit, else the narrow side first. */
function splitColumns(width: number, west: number, east: number): [number, number] {
  if (west === 0) {
    return [0, width];
  }
  if (east === 0) {
    return [width, 0];
  }
  if (west + COLUMN_GAP + east <= width) {
    return [west, width - west];
  }
  const half = width / 2;
  if (west <= half) {
    return [west, width - west];
  }
  if (east <= half) {
    return [width - east, east];
  }
  return [Math.floor(half), width - Math.floor(half)];
}

export function instanceLayout(
  instance: SystemInstance,
  sides: { west: readonly SizedRow[]; east: readonly SizedRow[] },
  subtitle: string,
  measure: TextMeasure
): InstanceLayout {
  const { west: westPins, east: eastPins } = sides;
  const west = naturalColumn(westPins, measure);
  const east = naturalColumn(eastPins, measure);
  const columns = west + east + (west > 0 && east > 0 ? COLUMN_GAP : 0) + NODE_BORDER;
  const header =
    measure(instance.name, 'semibold') +
    ROW_PADDING +
    NODE_BORDER +
    (instance.kind === 'hier' ? HIER_TOGGLE_WIDTH : 0);
  const sub = subtitle === '' ? 0 : measure(subtitle, 'subtitle') + ROW_PADDING + NODE_BORDER;
  const width = Math.ceil(
    clamp(Math.max(header, sub, columns), INSTANCE_MIN_WIDTH, INSTANCE_MAX_WIDTH)
  );
  const [westWidth, eastWidth] = splitColumns(width - NODE_BORDER, west, east);
  const labels = new Map<string, string>();
  for (const row of westPins) {
    labels.set(row.name, labelFor(row, westWidth, measure));
  }
  for (const row of eastPins) {
    labels.set(row.name, labelFor(row, eastWidth, measure));
  }
  return { width, westWidth, eastWidth, labels };
}

/**
 * Inner padding of an expanded frame beside its west and east borders: wide
 * enough for the widest pin label of that side, which sits inside the border.
 */
export function framePadding(
  sides: { west: readonly SystemPin[]; east: readonly SystemPin[] },
  measure: TextMeasure
): { west: number; east: number } {
  const room = (pins: readonly SystemPin[]) => Math.max(FRAME_MARGIN, naturalColumn(pins, measure));
  return { west: room(sides.west), east: room(sides.east) };
}

export function boundaryLayout(pin: SystemPin, measure: TextMeasure): BoundaryLayout {
  const semibold: TextMeasure = (text) => measure(text, 'semibold');
  const width = Math.ceil(
    clamp(semibold(pin.name, 'semibold') + BOUNDARY_CHROME, BOUNDARY_MIN_WIDTH, BOUNDARY_MAX_WIDTH)
  );
  return { width, label: middleEllipsis(pin.name, width - BOUNDARY_CHROME, semibold) };
}
