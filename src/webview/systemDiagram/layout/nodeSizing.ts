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
const MARKER_WIDTH = 8;
const MARKER_GAP = 4;
const COLUMN_GAP = 16;
/** Horizontal space a pin row spends besides its text. */
const ROW_CHROME = ROW_PADDING + MARKER_WIDTH + MARKER_GAP;
/** Room for the right-aligned "OPEN" hint and chevron in a hierarchy block header. */
const HIER_HINT_WIDTH = 52;
const ELLIPSIS = '…';
const START_SHARE = 0.6;

export interface InstanceLayout {
  width: number;
  westWidth: number;
  eastWidth: number;
  /** Display text per pin name: the full name or its middle-ellipsized form. */
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

function labelFor(name: string, columnWidth: number, measure: TextMeasure): string {
  return middleEllipsis(name, columnWidth - ROW_CHROME, measure);
}

function naturalColumn(names: readonly string[], measure: TextMeasure): number {
  if (names.length === 0) {
    return 0;
  }
  return ROW_CHROME + Math.max(...names.map((name) => measure(name, 'normal')));
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
  sides: { west: readonly SystemPin[]; east: readonly SystemPin[] },
  subtitle: string,
  measure: TextMeasure
): InstanceLayout {
  const { west: westPins, east: eastPins } = sides;
  const west = naturalColumn(
    westPins.map((pin) => pin.name),
    measure
  );
  const east = naturalColumn(
    eastPins.map((pin) => pin.name),
    measure
  );
  const columns = west + east + (west > 0 && east > 0 ? COLUMN_GAP : 0) + NODE_BORDER;
  const header =
    measure(instance.name, 'semibold') +
    ROW_PADDING +
    NODE_BORDER +
    (instance.kind === 'hier' ? HIER_HINT_WIDTH : 0);
  const sub = subtitle === '' ? 0 : measure(subtitle, 'subtitle') + ROW_PADDING + NODE_BORDER;
  const width = Math.ceil(
    clamp(Math.max(header, sub, columns), INSTANCE_MIN_WIDTH, INSTANCE_MAX_WIDTH)
  );
  const [westWidth, eastWidth] = splitColumns(width - NODE_BORDER, west, east);
  const labels = new Map<string, string>();
  for (const pin of westPins) {
    labels.set(pin.name, labelFor(pin.name, westWidth, measure));
  }
  for (const pin of eastPins) {
    labels.set(pin.name, labelFor(pin.name, eastWidth, measure));
  }
  return { width, westWidth, eastWidth, labels };
}

export function boundaryLayout(pin: SystemPin, measure: TextMeasure): BoundaryLayout {
  const width = Math.ceil(
    clamp(naturalColumn([pin.name], measure) + NODE_BORDER, BOUNDARY_MIN_WIDTH, BOUNDARY_MAX_WIDTH)
  );
  return { width, label: labelFor(pin.name, width - NODE_BORDER, measure) };
}
