/**
 * Fixed colors of the exported diagram images. This is the TypeScript source of truth for the
 * image palette: the webview resolves `--vscode-*` tokens at run time, an exported image has no
 * theme, so the same tokens are pinned here to the VS Code Light Modern and Dark Modern values.
 *
 * Token values are copied from scripts/docs-screenshots/theme/light.css and dark.css. Roles the
 * webview derives with `color-mix(in srgb, ...)` (systemDiagram.css `--sd-node-*`, colors.ts
 * `restingWireColor`) are computed with {@link mixSrgb} using the same formulas.
 */

import type { NetCategory } from '../../domain/systemGraph';

export type RenderTheme = 'light' | 'dark';

/** A color with the opacity it is drawn at (a `color-mix` against `transparent`). */
export interface Paint {
  /** `#rrggbb`. */
  color: string;
  opacity: number;
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
  blue: string;
  green: string;
  orange: string;
  purple: string;
  red: string;
}

// Light Modern, from scripts/docs-screenshots/theme/light.css.
const LIGHT_TOKENS: Tokens = {
  background: '#ffffff',
  foreground: '#3b3b3b',
  descriptionForeground: '#3b3b3b',
  widgetBackground: '#f8f8f8',
  widgetBorder: '#e5e5e5',
  blue: '#4facfe',
  green: '#388a34',
  orange: '#ce9178',
  purple: '#652d90',
  red: '#e51400',
};

// Dark Modern, from scripts/docs-screenshots/theme/dark.css.
const DARK_TOKENS: Tokens = {
  background: '#1f1f1f',
  foreground: '#cccccc',
  descriptionForeground: '#9d9d9d',
  widgetBackground: '#202020',
  widgetBorder: '#2b2b2b',
  blue: '#4facfe',
  green: '#89d185',
  orange: '#ce9178',
  purple: '#b180d7',
  red: '#f14c4c',
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
  };
}

const PALETTES: Record<RenderTheme, Palette> = {
  light: buildPalette(LIGHT_TOKENS),
  dark: buildPalette(DARK_TOKENS),
};

export function paletteFor(theme: RenderTheme): Palette {
  return PALETTES[theme];
}
