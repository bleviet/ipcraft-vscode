# Diagram renderer

`src/shared/render/` turns a laid-out diagram into a standalone SVG without a
browser. It backs `ipcraft render` and the interactive Export image of the system
viewer and the IP core editor (issue #268), so an image looks the same whichever
way it was made. It draws whole system levels and IP core symbols.

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

## Workspace definitions and manifests

`ipcraft render` of a system design runs the same enrichment as the viewer, so
an image shows the pins the viewer shows. The pipeline is one function,
`enrichSystemGraph` (`src/services/systemDiagram/enrichment/`): subsystem
grafting (`expandSubsystems`), `matchDefinitions`, `definitionFromIpCore` and
`definitionFromHdl`, `applyDefinitions`. It does no I/O of its own: the caller
passes an `EnrichmentIo` (the three file lists and `readText`) and an optional
logger. There are two adapters:

| Adapter | Files | Extras |
|---|---|---|
| `SystemDesignEnricher`, `SubsystemExpander` | `WorkspaceFileIndex` over `vscode.workspace.findFiles`, watchers | trust check |
| `src/cli/workspaceIo.ts` | sorted `fs` walk of `--workspace` | lists cached per directory for the process |

Both build index entries with the pure `fileEntries.ts`, so matching, the HDL
size cap and the entity/module scan cannot differ. `enrichSystemGraph` stays
below the CLI and the extension in the dependency order.

`--manifest` (`cli/renderManifest.ts`) renders a list of images in one process.
`renderManifestSpec.ts` converts an entry, with the manifest `defaults`
underneath, into the argv of the equivalent `ipcraft render` call and
`parseRenderArgs` validates it, so flags and manifest keys share one set of
rules. A `RenderSession` holds what is loaded once for the batch: fonts, bus
libraries per `useBusLibrary` folder and the workspace file lists; the wasm
rasterizer is already once per process.

## Shared render service

`src/services/render/` is the Node-side service both callers use, so neither
duplicates the layout, drawing or encoding steps:

| Module | Responsibility |
|---|---|
| `systemLevelImage.ts` | `renderSystemLevelImage(graph, request, look, encoding, assets, roots)`: lays a level out (expansion, `isolateNodes`, Clocks and resets) and draws it; `request` carries resolved ids and paths only |
| `ipSymbolImage.ts` | `parseIpCoreDocument`, `renderIpSymbolImage(data, library, request, ...)`: the symbol of an `.ip.yml` with the caller's bus library |
| `imageEncoding.ts` | `RenderLook`, `ImageEncoding`, `encodeImage`: SVG text or PNG/JPG bytes |
| `renderResources.ts` | `RenderAssets`: fonts and bus libraries loaded once |

The callers adapt it. The CLI (`src/cli/render.ts`) resolves names (`--select`,
`--expand`) to ids, loads the built-in bus library and writes a file. The
extension (`src/providers/imageExport/ImageExportHost.ts`) passes the graph the
system viewer already shows (enriched by `SystemDesignEnricher`, unsaved edits
included) and the IP core document text with the library the editor resolved,
then asks where to save. The extension bundle loads ELK from `dist/elk.bundled.js`
and the rasterizer from `dist/resources/resvg.wasm`, like the CLI.

Current view crops differ per editor. The system viewer sends the ids of the
nodes inside its viewport (`visibleNodeIds`, from node positions and the React
Flow transform); the service lays the level out with the Plex metrics and crops
to the union of those nodes (`cropNodeIds`), because block sizes can differ from
the canvas, which measures with the editor font. The IP symbol layout does not
depend on font metrics, so the canvas viewport maps exactly to a layout rectangle
(`visibleLayoutRect`) and the service crops to it (`crop`).
