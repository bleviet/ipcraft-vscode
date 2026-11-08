# Diagram renderer

`src/shared/render/` turns a laid-out diagram into a standalone SVG without a
browser. It backs `ipcraft render` (issue #268) and is meant to back the
interactive image export later, so an image looks the same whichever way it was
made. It draws whole system levels and IP core symbols.

## Boundaries

The module is pure and runs in Node and in a browser: no DOM, no React, no CSS
and no file access. It sits above the pure layout code and below the callers:

```
domain, layout (src/webview/systemDiagram/layout, legend.ts, model.ts)
  -> src/shared/render
  -> src/cli/render.ts (reads files, runs the layout, writes the SVG)
```

It imports only DOM-free layout and model modules from the system diagram, and
`canvas/canvasLayout.ts` from the IP core canvas. Fonts
come in as bytes (`fontFaceCss`), so the renderer never reads files. The CLI
bundle has no `.css` loader: nothing on the render path may import CSS, React or
`@xyflow/react` at runtime (`layout/nodeHandles.ts` keeps its own `Position`
values for that reason).

## Modules

| Module | Responsibility |
|---|---|
| `systemLevelSvg.ts` | `renderSystemLevelSvg`: document, background, grid, draw order, legend placement |
| `blockSvg.ts` | Instance blocks and expanded frames: header, subtitle, hierarchy toggle, pin rows |
| `pinSvg.ts` | Pin markers, net badges, external port tags |
| `legendSvg.ts` | Legend layout (wrapping rows) and drawing |
| `ipSymbolSvg.ts` | `renderIpSymbolSvg`: IP core symbol document, block header and sections, bounds, grid |
| `ipPortSvg.ts` | IP symbol ports: stubs, dots, icons, badges, collapsed bus bundles |
| `palette.ts` | Light and Dark colors; `mixSrgb` |
| `textMetrics.ts`, `fontMetrics.generated.ts` | IBM Plex text measurement, baselines, truncation |
| `fontFaces.ts` | Base64 `@font-face` rules for the three WOFF files |
| `woffToSfnt.ts` | WOFF 1.0 to TrueType unwrapping, for the rasterizer |
| `raster.ts` | `rasterize`: SVG to PNG or JPG (resvg-wasm, jpeg-js) |
| `svg.ts`, `textSvg.ts` | Escaping, number formatting, one-line text |

## Palette

`palette.ts` is the TypeScript source of truth for the colors of exported
images. The webview resolves `--vscode-*` tokens at run time; an image has no
theme, so the same tokens are pinned to the Light Modern and Dark Modern values
copied from `scripts/docs-screenshots/theme/`. Roles the webview derives with
`color-mix` (`--sd-node-line`, `--sd-node-fill`, `--sd-node-head-fill`, resting
wires) are computed with `mixSrgb` using the same formulas. When a color changes
in `systemDiagram.css` or `colors.ts`, change the palette too; `Palette.ip` mirrors
`canvas.css` the same way. The charts blue, orange and yellow come from the VS Code color registry defaults (Light
Modern and Dark Modern do not override them). No palette value contains `var(`.

## Text and fonts

Text is drawn in IBM Plex Sans (400, 600) and IBM Plex Mono (400), measured with
their advance widths. `fontMetrics.generated.ts` is written by
`npm run generate:font-metrics` from the `@fontsource` devDependencies with
fontkit; fontkit never runs at runtime. The SVG sets `font-kerning: none` and `text-rendering: geometricPrecision` (without it Chrome on
Linux rounds every glyph advance to a whole pixel and measured text overflows its block), so
drawn widths equal measured widths. `plexTextMeasure` is the `TextMeasure` the
layout uses in Node, with the webview's weights (11 px body, 12 px semibold, 10.5
px mono). Characters outside the table are measured as `M`. The WOFF (1.0) files are
copied to `dist/resources/fonts/` (`ResourceRoots.fontsDir`) and allow-listed in
`scripts/check-vsix.js` and `scripts/prepare-cli-package.js`.

## Differences from the canvas

The canvas styling lives in `systemDiagram.css`; the renderer mirrors it in
code. Deliberate simplifications are listed in the `systemLevelSvg.ts` header:
no shadows, user highlight colors, dimming, review or selected clock tree;
the legend sits below the drawing; grid dots are slightly larger for print.
Output is deterministic: numbers have at most two decimals and elements follow
the layout order (frames, wires, blocks, legend).

## Decorations

`renderSystemLevelSvg` draws what the layout carries plus two optional inputs,
and without them its output is byte-identical to an undecorated render.

- **Selection.** `selectedNodeIds` draws the viewer's selected style (focus
  color outline; `data-selected="true"` on the node group). The CLI passes the
  `--select` and `--highlight` nodes (`cli/renderSystemOptions.ts`). `--select`
  isolates with `hopDistances`, `isolationSubset` and `maxRadius` and passes the
  subset to `buildElkInput` as `isolate`, as `useElkLayout` does.
- **Clocks and resets.** `clockDecor` (domain mode) and `applyClockDecor` merge
  the domain strips, pin marks and wire marks into the node and edge data, with
  `clockNodeData`, the same function `useCanvasElements` uses. The renderer
  reads them from the data: `decorSvg.ts` draws the strip, header count,
  frequency labels and selection ring; `blockSvg.ts` and `pinSvg.ts` color the
  markers and crossing pins; `systemLevelSvg.ts` dashes crossing wires in the
  warning color and fades the other data wires; `legendSvg.ts` appends the
  `domainLegend` entries. Domain colors are CSS variables in the webview;
  `resolveColor` maps them through `Palette.tokens`. Frequency labels get a
  halo in the background color, like the viewer's text shadow.

## IP core symbol

`renderIpSymbolSvg(layout, options)` draws what the IP core editor's canvas shows
in its default state from a `CanvasLayout`. The geometry is not recomputed: the
layout comes from `computeLayout` in `canvas/canvasLayout.ts`, called through
`computeSymbolLayout` in `canvas/symbolInputs.ts`, the pure module that also
builds the bus-library lookups, protocol labels and clock-domain colors for
`IpBlockCanvas.tsx`, so the canvas and the CLI cannot drift. `IpBlockDiagram.tsx`
and the `Canvas*` components cannot be imported (they load React and the webview
host), so `ipSymbolSvg.ts` and `ipPortSvg.ts` mirror their geometry and
`canvas.css` styles by hand; change both together. Colors are `Palette.ip`. The
IP canvas colors clocks green and resets orange, while the system diagram colors
them orange and red; both are kept as the editors draw them.

`src/cli/renderIpCore.ts` reads the file (`yaml` parse, format version check,
`canonicalizeParsedIpCore`), loads the built-in bus library plus the file's
`useBusLibrary` folder, and writes the SVG. Simplifications are listed in the
`ipSymbolSvg.ts` header: no selection, hover, rename or validation marks, bus
bundles always collapsed, no drop shadow, the canvas margin cropped to 24 px
around the drawing, and small native shapes in place of the glyphs the embedded
fonts lack.

## PNG and JPG

`rasterize` (`raster.ts`) draws the same SVG with `@resvg/resvg-wasm`: the wasm
module is initialized once per process from bytes the caller reads
(`ResourceRoots.resvgWasmPath`, `dist/resources/resvg.wasm`), so the glue never
fetches or resolves a URL, which keeps it bundleable into `dist/cli.js`. The zoom
is `--scale`; PNG is resvg's `asPng()`, JPG is its RGBA pixels through `jpeg-js`
(no alpha, so the drawing, system level or IP symbol, is flattened onto the palette
background; a transparent JPG is rejected by the parser). Output is
deterministic.

resvg ignores CSS `@font-face` and does not read WOFF or WOFF2, so the CLI passes
the same three shipped WOFF files through `woffToSfnt` (Node's `zlib.inflateSync`
as the inflate function) and gives resvg the TrueType bytes; system fonts are
off. One shipped format therefore serves both outputs. Known differences from a
browser:

- Semibold sans text names the family
  `'IBM Plex Sans SemiBold', 'IBM Plex Sans', sans-serif`
  (`SANS_SEMIBOLD_FAMILY`), because resvg matches the family name table of the
  TrueType file, which for the 600 face is "IBM Plex Sans SemiBold". The SVGs
  define no `@font-face` of that name, so a browser uses the embedded
  'IBM Plex Sans' at weight 600, or a locally installed 'IBM Plex Sans SemiBold'
  (the same design) if there is one.
- resvg does not synthesize bold, so any text the SVG asks for in bold uses the
  regular face (IBM Plex Mono ships only at 400; Sans has real 400 and 600 faces).
- It does not apply `font-kerning` or `text-rendering` hints, and its glyph
  rasterization (anti-aliasing, hinting) differs slightly from Chrome's, so
  pixels are not identical to a screenshot of the webview.
