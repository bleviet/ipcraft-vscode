# Diagram renderer

`src/shared/render/` turns a laid-out diagram into a standalone SVG without a
browser. It backs `ipcraft render` (issue #268) and is meant to back the
interactive image export later, so an image looks the same whichever way it was
made. Today it draws whole system levels.

## Boundaries

The module is pure and runs in Node and in a browser: no DOM, no React, no CSS
and no file access. It sits above the pure layout code and below the callers:

```
domain, layout (src/webview/systemDiagram/layout, legend.ts, model.ts)
  -> src/shared/render
  -> src/cli/render.ts (reads files, runs the layout, writes the SVG)
```

It imports only DOM-free layout and model modules from the system diagram. Fonts
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
| `palette.ts` | Light and Dark colors; `mixSrgb` |
| `textMetrics.ts`, `fontMetrics.generated.ts` | IBM Plex text measurement, baselines, truncation |
| `fontFaces.ts` | Base64 `@font-face` rules for the three woff2 files |
| `svg.ts`, `textSvg.ts` | Escaping, number formatting, one-line text |

## Palette

`palette.ts` is the TypeScript source of truth for the colors of exported
images. The webview resolves `--vscode-*` tokens at run time; an image has no
theme, so the same tokens are pinned to the Light Modern and Dark Modern values
copied from `scripts/docs-screenshots/theme/`. Roles the webview derives with
`color-mix` (`--sd-node-line`, `--sd-node-fill`, `--sd-node-head-fill`, resting
wires) are computed with `mixSrgb` using the same formulas. When a color changes
in `systemDiagram.css` or `colors.ts`, change the palette too. No palette value
contains `var(`.

## Text and fonts

Text is drawn in IBM Plex Sans (400, 600) and IBM Plex Mono (400), measured with
their advance widths. `fontMetrics.generated.ts` is written by
`npm run generate:font-metrics` from the `@fontsource` devDependencies with
fontkit; fontkit never runs at runtime. The SVG sets `font-kerning: none`, so
drawn widths equal measured widths. `plexTextMeasure` is the `TextMeasure` the
layout uses in Node, with the webview's weights (11 px body, 12 px semibold, 10.5
px mono). Characters outside the table are measured as `M`. The woff2 files are
copied to `dist/resources/fonts/` (`ResourceRoots.fontsDir`) and allow-listed in
`scripts/check-vsix.js` and `scripts/prepare-cli-package.js`.

## Differences from the canvas

The canvas styling lives in `systemDiagram.css`; the renderer mirrors it in
code. Deliberate simplifications are listed in the `systemLevelSvg.ts` header:
no shadows, selection, highlights, dimming, review or clock-domain decoration;
the legend sits below the drawing; grid dots are slightly larger for print.
Output is deterministic: numbers have at most two decimals and elements follow
the layout order (frames, wires, blocks, legend).
