/**
 * Fixed colors of the exported diagram images. This is the TypeScript source of truth for the
 * image palette: the webview resolves `--vscode-*` tokens at run time, an exported image has no
 * theme, so the same tokens are pinned here to the VS Code Light Modern and Dark Modern values.
 *
 * Token values are copied from scripts/docs-screenshots/theme/light.css and dark.css (the charts
 * blue, orange and yellow are the VS Code color registry defaults; the gitDecoration colors are the
 * bundled git extension's). Roles the
 * webview derives with `color-mix(in srgb, ...)` (systemDiagram.css `--sd-node-*`, colors.ts
 * `restingWireColor`) are computed with {@link mixSrgb} using the same formulas.
 */

import type { NetCategory } from '../../domain/systemGraph';
import type { MarkStatus } from '../../webview/systemDiagram/changeMarks';

export type RenderTheme = 'light' | 'dark';

/** A color with the opacity it is drawn at (a `color-mix` against `transparent`). */
export interface Paint {
  /** `#rrggbb`. */
  color: string;
  opacity: number;
}

/**
 * Roles of the IP core symbol, from canvas.css. The IP canvas colors clocks and resets differently
 * from the system diagram (charts-green clocks and charts-orange resets here; orange and red in
 * `Palette.category`). Both are kept as the two editors draw them.
 */
export interface IpSymbolPalette {
  /** `.ip-block-body` fill (`--vscode-editor-background`) and stroke (`--vscode-panel-border`). */
  bodyFill: string;
  bodyStroke: string;
  /** `.ip-block-header`: focusBorder 20% over the background. */
  headerFill: string;
  /** `.ip-canvas-grid-dot`: foreground at 10%. */
  gridDot: Paint;
  /** Generics and vendor/library rows (`--vscode-charts-yellow`); also polarity and interrupt badges. */
  yellow: string;
  /** Dependencies section (`--vscode-charts-blue`). */
  dependency: string;
  /** Port kind colors: stubs, dots and icons of clocks, resets and interrupts. */
  clock: string;
  reset: string;
  interrupt: string;
  /** Bus bundle stub, connector and badge border (`--vscode-charts-blue`). */
  bus: string;
  /** Bus protocol badge: bus color 20% over the background. */
  busBadgeFill: string;
  /** Expand toggle: bus color 15% over the background. */
  busToggleFill: string;
  /** Mode (S/M) badge: charts-purple, fill 30% over the background. */
  modeStroke: string;
  modeFill: string;
  /** Array count badge: charts-orange, fill 20% over the background. */
  arrayStroke: string;
  arrayFill: string;
  /** Memory map reference badge: charts-green, fill 18% over the background. */
  mmapStroke: string;
  mmapFill: string;
}

export interface Palette {
  /** `--vscode-editor-background`. */
  background: string;
  /** `--vscode-foreground`. */
  foreground: string;
  /** `--vscode-descriptionForeground`. */
  descriptionForeground: string;
  /** `--sd-node-line`: foreground at 90%. */
  nodeLine: Paint;
  /** `--sd-node-fill`: foreground 3% over the background. */
  nodeFill: string;
  /** `--sd-node-head-fill`: foreground 10% over the background. */
  nodeHeadFill: string;
  /** Expanded frame body: `--vscode-editorWidget-background` at 35%. */
  frameFill: Paint;
  /** `--vscode-editorWidget-background`. */
  widgetBackground: string;
  /** `--vscode-editorWidget-border` (legend outline). */
  widgetBorder: string;
  /** Background grid dots: foreground at 25%. */
  gridDot: Paint;
  /** Full category colors: pin markers, badge stubs, legend bars. */
  category: Readonly<Record<NetCategory, string>>;
  /** Category colors of wires at rest: 65% of the category color over the background. */
  wire: Readonly<Record<NetCategory, string>>;
  /** `--vscode-focusBorder`: the outline of a selected or highlighted block. */
  focusBorder: string;
  /** `--vscode-editorWarning-foreground`: clock domain crossings. */
  warning: string;
  /**
   * The `--vscode-*` tokens the clock domain colors use (clockDomains.ts `DOMAIN_COLORS`,
   * domainView.ts `UNRELEASED_RESET_COLOR`), by name without `var()`; see {@link resolveColor}.
   */
  tokens: Readonly<Record<string, string>>;
  /** The marks of a comparison (systemDiagram.css `--sd-change-*`): a color per kind of change, and the new wires. */
  change: Readonly<Record<MarkStatus | 'newWire', string>>;
  /** IP core symbol roles. */
  ip: IpSymbolPalette;
}

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16)) as [number, number, number];
}

function toHex(channels: readonly number[]): string {
  return `#${channels
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`;
}

/** `color-mix(in srgb, a pct%, b)`: `pct` percent of `a` over the rest of `b`, as `#rrggbb`. */
export function mixSrgb(a: string, b: string, pct: number): string {
  const share = pct / 100;
  const from = parseHex(a);
  const to = parseHex(b);
  return toHex(from.map((channel, index) => channel * share + to[index] * (1 - share)));
}

interface Tokens {
  background: string;
  foreground: string;
  descriptionForeground: string;
  widgetBackground: string;
  widgetBorder: string;
  panelBorder: string;
  focusBorder: string;
  yellow: string;
  blue: string;
  green: string;
  orange: string;
  purple: string;
  red: string;
  warning: string;
  ansiCyan: string;
  ansiMagenta: string;
  /** `--vscode-gitDecoration-addedResourceForeground`, `-deletedResourceForeground`, `-modifiedResourceForeground`, `-ignoredResourceForeground`. */
  gitAdded: string;
  gitDeleted: string;
  gitModified: string;
  gitIgnored: string;
}

// Light Modern, from scripts/docs-screenshots/theme/light.css.
const LIGHT_TOKENS: Tokens = {
  background: '#ffffff',
  foreground: '#3b3b3b',
  descriptionForeground: '#3b3b3b',
  widgetBackground: '#f8f8f8',
  widgetBorder: '#e5e5e5',
  panelBorder: '#e5e5e5',
  focusBorder: '#005fb8',
  yellow: '#bf8803',
  blue: '#0063d3',
  green: '#388a34',
  orange: '#d18616',
  purple: '#652d90',
  red: '#e51400',
  warning: '#bf8803',
  ansiCyan: '#0598bc',
  ansiMagenta: '#bc05bc',
  gitAdded: '#587c0c',
  gitDeleted: '#ad0707',
  gitModified: '#895503',
  gitIgnored: '#8e8e90',
};

// Dark Modern, from scripts/docs-screenshots/theme/dark.css.
const DARK_TOKENS: Tokens = {
  background: '#1f1f1f',
  foreground: '#cccccc',
  descriptionForeground: '#9d9d9d',
  widgetBackground: '#202020',
  widgetBorder: '#2b2b2b',
  panelBorder: '#2b2b2b',
  focusBorder: '#0078d4',
  yellow: '#cca700',
  blue: '#59a4f9',
  green: '#89d185',
  orange: '#d18616',
  purple: '#b180d7',
  red: '#f14c4c',
  warning: '#cca700',
  ansiCyan: '#11a8cd',
  ansiMagenta: '#bc3fbc',
  gitAdded: '#81b88b',
  gitDeleted: '#c74e39',
  gitModified: '#e2c08d',
  gitIgnored: '#8c8c8c',
};

/** The colors of colors.ts `CATEGORY_COLORS`, by token. */
function categoryColors(t: Tokens): Record<NetCategory, string> {
  return {
    aximm: t.blue,
    axis: t.green,
    avalonmm: t.blue,
    avalonst: t.green,
    interface: t.descriptionForeground,
    clock: t.orange,
    reset: t.red,
    interrupt: t.purple,
    signal: t.descriptionForeground,
  };
}

function buildIpSymbolPalette(t: Tokens): IpSymbolPalette {
  return {
    bodyFill: t.background,
    bodyStroke: t.panelBorder,
    headerFill: mixSrgb(t.focusBorder, t.background, 20),
    gridDot: { color: t.foreground, opacity: 0.1 },
    yellow: t.yellow,
    dependency: t.blue,
    clock: t.green,
    reset: t.orange,
    interrupt: t.yellow,
    bus: t.blue,
    busBadgeFill: mixSrgb(t.blue, t.background, 20),
    busToggleFill: mixSrgb(t.blue, t.background, 15),
    modeStroke: t.purple,
    modeFill: mixSrgb(t.purple, t.background, 30),
    arrayStroke: t.orange,
    arrayFill: mixSrgb(t.orange, t.background, 20),
    mmapStroke: t.green,
    mmapFill: mixSrgb(t.green, t.background, 18),
  };
}

function buildPalette(t: Tokens): Palette {
  const category = categoryColors(t);
  const wire = Object.fromEntries(
    Object.entries(category).map(([name, color]) => [name, mixSrgb(color, t.background, 65)])
  ) as Record<NetCategory, string>;
  return {
    background: t.background,
    foreground: t.foreground,
    descriptionForeground: t.descriptionForeground,
    nodeLine: { color: t.foreground, opacity: 0.9 },
    nodeFill: mixSrgb(t.foreground, t.background, 3),
    nodeHeadFill: mixSrgb(t.foreground, t.background, 10),
    frameFill: { color: t.widgetBackground, opacity: 0.35 },
    widgetBackground: t.widgetBackground,
    widgetBorder: t.widgetBorder,
    gridDot: { color: t.foreground, opacity: 0.25 },
    category,
    wire,
    focusBorder: t.focusBorder,
    warning: t.warning,
    tokens: {
      '--vscode-charts-blue': t.blue,
      '--vscode-charts-purple': t.purple,
      '--vscode-charts-green': t.green,
      '--vscode-charts-orange': t.orange,
      '--vscode-terminal-ansiCyan': t.ansiCyan,
      '--vscode-terminal-ansiMagenta': t.ansiMagenta,
      '--vscode-descriptionForeground': t.descriptionForeground,
      '--vscode-editorWarning-foreground': t.warning,
    },
    change: {
      added: t.gitAdded,
      // Images do not draw ghosts yet (the viewer does). The entry is here for the type of `MarkStatus`;
      // `changeSvg` would draw a block with this status solid, as the others, until a later change draws ghosts.
      removed: t.gitDeleted,
      changed: t.gitModified,
      renamed: t.purple,
      moved: t.purple,
      version: t.gitIgnored,
      newWire: t.gitAdded,
    },
    ip: buildIpSymbolPalette(t),
  };
}

const PALETTES: Record<RenderTheme, Palette> = {
  light: buildPalette(LIGHT_TOKENS),
  dark: buildPalette(DARK_TOKENS),
};

export function paletteFor(theme: RenderTheme): Palette {
  return PALETTES[theme];
}

/** The fixed color of a `var(--vscode-*)` token the system diagram uses for clock domains. */
export function resolveColor(palette: Palette, cssColor: string): string {
  const token = /^var\((--[\w-]+)\)$/.exec(cssColor)?.[1];
  const color = token === undefined ? undefined : palette.tokens[token];
  if (color === undefined) {
    throw new Error(`No fixed color for '${cssColor}' in the render palette`);
  }
  return color;
}
