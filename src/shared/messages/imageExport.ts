/**
 * Interactive "Export image" of the system viewer and the IP core editor: the options the user
 * picks, the view state the webview sends with them, and the sanitizer the extension host applies
 * to whatever arrives (a message is untrusted input). Pure and shared by both processes.
 */

export type ExportImageFormat = 'svg' | 'png' | 'jpg';
export type ExportImageArea = 'view' | 'whole';

export interface ExportImageOptions {
  format: ExportImageFormat;
  /** `view`: what the canvas shows; `whole`: the full level or symbol. */
  area: ExportImageArea;
  /** Pixels per SVG unit, 1-4; PNG and JPG only. */
  scale: number;
  theme: 'light' | 'dark';
  grid: boolean;
  /** System viewer only. */
  legend: boolean;
  /** JPG is always opaque. */
  background: 'editor' | 'transparent';
}

/** Light for print, PNG at 2x: the defaults of issue #268. */
export const DEFAULT_EXPORT_OPTIONS: ExportImageOptions = {
  format: 'png',
  area: 'view',
  scale: 2,
  theme: 'light',
  grid: true,
  legend: true,
  background: 'editor',
};

/** A rectangle in the symbol's layout coordinates. */
export interface ExportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What the system viewer shows, as the extension host redraws it. */
export interface SystemExportView {
  levelPath: string;
  /** Hierarchy blocks drawn expanded (instance paths). */
  expanded: string[];
  /** The isolated view: its selected nodes and radius; absent when the level is whole. */
  isolate?: { nodeIds: string[]; hops: number };
  /** Clocks and resets is on. */
  clocks: boolean;
  /** Nodes drawn with the selection outline. */
  selectedNodeIds: string[];
  /** Area `view`: the nodes inside the canvas viewport. */
  visibleNodeIds?: string[];
}

/** JPEG quality of an exported JPG. */
export const DEFAULT_JPEG_QUALITY = 90;

/** What the IP core canvas shows. */
export interface IpExportView {
  /** Some bus bundle is expanded on the canvas; the image always draws bundles collapsed. */
  bundlesExpanded?: boolean;
  /** Area `view`: the visible part of the canvas in layout coordinates. */
  visibleRect?: ExportRect;
}

export const EXPORT_FORMATS: readonly ExportImageFormat[] = ['svg', 'png', 'jpg'];

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** The options in `raw`, field by field; anything missing or invalid takes its default. */
export function sanitizeExportOptions(raw: unknown): ExportImageOptions {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const format = pick(source.format, EXPORT_FORMATS, DEFAULT_EXPORT_OPTIONS.format);
  const scale = Math.round(Number(source.scale));
  const flag = (value: unknown, fallback: boolean) =>
    typeof value === 'boolean' ? value : fallback;
  return {
    format,
    area: pick(source.area, ['view', 'whole'], DEFAULT_EXPORT_OPTIONS.area),
    scale: scale >= 1 && scale <= 4 ? scale : DEFAULT_EXPORT_OPTIONS.scale,
    theme: pick(source.theme, ['light', 'dark'], DEFAULT_EXPORT_OPTIONS.theme),
    grid: flag(source.grid, DEFAULT_EXPORT_OPTIONS.grid),
    legend: flag(source.legend, DEFAULT_EXPORT_OPTIONS.legend),
    background:
      format === 'jpg'
        ? 'editor'
        : pick(source.background, ['editor', 'transparent'], DEFAULT_EXPORT_OPTIONS.background),
  };
}

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

/** The view state in `raw`, or undefined when it is not a well-formed {@link SystemExportView}. */
export function parseSystemExportView(raw: unknown): SystemExportView | undefined {
  const view = raw as Partial<Record<keyof SystemExportView, unknown>> | null;
  if (
    typeof view !== 'object' ||
    view === null ||
    typeof view.levelPath !== 'string' ||
    !isStringArray(view.expanded) ||
    !isStringArray(view.selectedNodeIds) ||
    typeof view.clocks !== 'boolean'
  ) {
    return undefined;
  }
  const isolate = view.isolate as { nodeIds?: unknown; hops?: unknown } | undefined;
  if (isolate !== undefined) {
    if (
      typeof isolate !== 'object' ||
      isolate === null ||
      !isStringArray(isolate.nodeIds) ||
      !Number.isInteger(isolate.hops)
    ) {
      return undefined;
    }
  }
  if (view.visibleNodeIds !== undefined && !isStringArray(view.visibleNodeIds)) {
    return undefined;
  }
  return view as unknown as SystemExportView;
}

/** The visible rectangle in `raw`, or undefined when it is missing or not finite and non-empty. */
export function parseExportRect(raw: unknown): ExportRect | undefined {
  const rect = raw as Partial<Record<keyof ExportRect, unknown>> | null;
  if (typeof rect !== 'object' || rect === null) {
    return undefined;
  }
  const { x, y, width, height } = rect;
  const numbers = [x, y, width, height];
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    return undefined;
  }
  return (width as number) > 0 && (height as number) > 0 ? (rect as ExportRect) : undefined;
}

/** `<name>-<level>` for a level path, `<name>` for the root; `/` becomes `_`. */
export function systemExportFileName(
  designName: string,
  levelPath: string,
  format: ExportImageFormat
): string {
  const level = levelPath.replace(/^\/+/, '').replace(/\//g, '_');
  return `${designName}${level === '' ? '' : `-${level}`}.${format}`;
}

const FORMAT_EXTENSIONS: Record<ExportImageFormat, readonly string[]> = {
  svg: ['.svg'],
  png: ['.png'],
  jpg: ['.jpg', '.jpeg'],
};

/**
 * An error message when the extension of `filePath` is not one of `format` (`.jpeg` is JPG, case
 * does not matter; no extension is a mismatch), else undefined. The file is never renamed: that
 * could overwrite a file the save dialog did not confirm.
 */
export function formatExtensionMismatch(
  filePath: string,
  format: ExportImageFormat
): string | undefined {
  const dot = filePath.lastIndexOf('.');
  const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const extension = dot > slash ? filePath.slice(dot).toLowerCase() : '';
  if (FORMAT_EXTENSIONS[format].includes(extension)) {
    return undefined;
  }
  const ends = extension === '' ? 'has no extension' : `ends in ${extension}`;
  return `The file name ${ends}, but the format is ${format.toUpperCase()}. Export again with a .${format} name, or pick another format in the export options.`;
}
