# Automated Docs Screenshots

Generating documentation images from the real compiled webview, driven by a declarative manifest.

## Why

Documentation screenshots are generated from the current compiled webviews.
This avoids the silent drift that occurred when the repository relied on a small
set of hand-captured images.

The browser test harness in `src/test/browser/` already loads the real compiled webview bundles and renders real YAML. Screenshot generation is therefore not new infrastructure -- it is one additional consumer of an existing harness.

## Goals

- One command regenerates every docs image from live code, so images cannot silently go stale.
- Adding an image for a new concept is a one-entry data change, not new Playwright boilerplate.
- A UI change that invalidates a screenshot fails loudly instead of producing a quietly wrong image.

## The maintenance model

Everything is driven by a manifest. One entry describes one image; a generic runner loops over the manifest and captures each entry in both themes.

| Situation                  | What you do                                                        |
| -------------------------- | ------------------------------------------------------------------ |
| New concept needs an image | Append one entry to `shots.ts`, embed its light PNG in markdown    |
| UI changed                 | Rerun `npm run docs:screenshots`; all images move forward together |
| UI change breaks a shot    | The `setup` selector fails and the run errors                      |

Images are never hand-edited. The manifest is the source of truth for which images exist; the compiled bundle is the source of truth for how they look.

There is deliberately **no CI staleness gate**. Regenerating on every PR would force a PNG refresh commit into each UI change and make diffs noisy. This stays a command the developer runs when docs matter.

## Existing harness

Three standalone HTML pages are loaded over `file://` with no dev server:

| Harness                                | Root                   | Bundles                       | Data injection                                             |
| -------------------------------------- | ---------------------- | ----------------------------- | ---------------------------------------------------------- |
| `src/test/browser/index.html`          | `#root`                | `dist/webview.{js,css}`       | `window.__RENDER__(text)`                                  |
| `src/test/browser/ipcore.html`         | `#ipcore-root`         | `dist/ipcore.{js,css}`        | `window.postMessage({type:'update', text, fileName}, '*')` |
| `src/test/browser/data-inspector.html` | `#data-inspector-root` | `dist/dataInspector.{js,css}` | `window.renderRecipe(recipe)`                              |

Both stub `acquireVsCodeApi` inline before the bundle script tag -- required, because `src/webview/vscode.ts` calls it at module load. Both signal readiness by posting `{type:'ready'}`, which the stub logs with a `VSCODE_MESSAGE:` prefix.

The asymmetry matters: each bundle uses its existing browser-test entry point.
`__RENDER__` belongs only to the Memory Map app, the IP Core app receives an
`update` message, and the Data Inspector harness exposes `renderRecipe`.

Several `ipcore` shots (`staging-overlay`, `consistency-findings`) don't reach their
target UI state through the canvas at all -- they post a synthetic extension-host
message (`stagingStart`, `consistencyResult`) directly at the already-mounted app,
the same messages `WebviewStagingBridge.ts` / `IpCoreEditorProvider.ts` send after a
real scaffold run or cross-check. This is the same `window.postMessage` mechanism
`openHarness` already uses for the initial `update` message -- just a second message
sent from a shot's `setup` callback once the app has mounted.

### Out of scope: native VS Code UI

Not every visual surface is a webview. Three features documented in the how-to guides
render through VS Code's own native chrome, not through `dist/webview.js` / `ipcore.js` /
`dataInspector.js`, and so cannot be captured by this pipeline at all:

| Feature | Why it's out of scope |
| --- | --- |
| **IPCraft Build** panel (`ReportsTreeProvider.ts`) | A `vscode.TreeDataProvider` -- pure Explorer-sidebar tree items, no HTML |
| **Preview Template Output** (`TemplatePreviewProvider.ts`) | A read-only virtual text document (`vscode.TextDocumentContentProvider`), opened as a normal editor tab -- not a webview |
| **Scaffold Pack Preview** panel (`ScaffoldPackPanel.ts`) | *Is* a `WebviewPanel`, but built from a self-contained HTML string outside the three webpack bundle entries this pipeline drives -- capturable in principle with a fourth harness, just not wired in yet |

Capturing any of these would need a real running VS Code window (e.g. `@vscode/test-electron`)
rather than a `file://` harness page, or -- for the Scaffold Pack Preview panel only -- a new
harness that serves its generated HTML directly. The affected how-to guides
([Building a Project](../how-to/building-a-project.md), [Scaffold Packs](../how-to/scaffold-packs.md))
say so explicitly rather than silently shipping without an image.

## Design

```text
scripts/docs-screenshots/
+-- shots.ts          # the manifest -- the only file you edit to add an image
+-- capture.spec.ts   # generic runner: each shot x each theme
+-- harness.ts        # load page, inject theme, feed YAML, wait for ready
+-- theme/
    +-- dump-theme.js # one-time snippet run in a real VS Code webview
    +-- dark.css      # Dark Modern (VS Code's bundled default; unused fallback)
    +-- dracula.css   # Dracula -- the active dark-theme stylesheet
    +-- light.css     # Light Modern -- the active light-theme stylesheet
config/playwright.docs.ts
docs/images/          # committed output
```

### Manifest

```ts
export interface Shot {
  id: string; // -> docs/images/<id>-{dark,light}.png
  harness: 'memorymap' | 'ipcore' | 'dataInspector';
  source: string; // repo-relative YAML path
  viewport?: { width: number; height: number };
  clip?: string; // optional selector -> capture one element
  setup?: (page: Page) => Promise<void>; // clicks/expansion before capture
}
```

Most editor source YAML comes from `examples/led_avmm/led_controller_avmm.{ip,mm}.yml` -- real, hardware-validated specs that the LED controller tutorials already walk through. The general Memory Map editor shot uses `ipcraft-spec/examples/comprehensive_axi/comprehensive_axi.mm.yml` and selects its field-rich `CTRL` register. The `src/test/fixtures/` files are deliberately minimal and would render a thin, unconvincing UI.

Manifest:

| id                                | Harness       | Capture                            | Used by                                                 |
| --------------------------------- | ------------- | ---------------------------------- | ------------------------------------------------------- |
| `memorymap-editor`                | memorymap     | full, with `CTRL` selected         | `README.md`, `docs/index.md`                            |
| `led-memorymap-editor`            | memorymap     | full                               | "The register map"                                      |
| `ipcore-editor`                   | ipcore        | full                               | `README.md`, `docs/index.md`, "Scaffolding the project" |
| `ipcore-toolbar`                  | ipcore        | toolbar header                     | IP Core Editor reference                                 |
| `custom-interface-conduit`        | ipcore        | full, with `DBG` conduit selected  | "Defining a Custom Interface"                            |
| `staging-overlay`                 | ipcore        | `.canvas-inspector`, via a synthetic `stagingStart` message | "Creating Your First IP Core", "Generating a Project" |
| `consistency-findings`            | ipcore        | `.canvas-inspector`, via a synthetic `consistencyResult` message | "Checking Consistency"                              |
| `scaffold-template-picker`         | ipcore        | toolbar `ToolbarGroup` around the Scaffold pack `<select>` | "Customising Code Generation (Scaffold Packs)"       |
| `outline-tree`                    | memorymap     | `aside.sidebar`                    | "The register map"                                      |
| `bitfield-visualizer`             | memorymap     | `main section`                     | "The register map" (LED_PATTERN)                        |
| `fields-table-access`             | memorymap     | `[data-fields-table="true"] table` | "The register map" (EVENTS, `monitorChangeOf`)          |
| `data-inspector-workspace`        | dataInspector | full                               | "Using the Data Inspector", visual-workspace reference  |
| `data-inspector-bit-visualizer`   | dataInspector | Continuous Vector Bits             | "Using the Data Inspector", architecture reference      |
| `data-inspector-operator-library` | dataInspector | Library rail                       | "Using the Data Inspector", visual-workspace reference  |
| `data-inspector-fields`           | dataInspector | Inspector rail                     | "Using the Data Inspector"                              |
| `data-inspector-capture`          | dataInspector | Inspector rail                     | capture examples                                        |

All four tutorial placements are in `docs/tutorials/led-controller-avmm-authoring.md` -- not `memory-mapped-registers.md`, whose worked example is `daq_controller`, a different fixture. The `EVENTS` register in the LED example is write-1-to-clear with `monitorChangeOf`, which is exactly what that tutorial's register-map section describes, and its register-map table matches the LED example field-for-field.

### Capture sequence

The runner reuses the existing harness HTML unmodified on disk -- no duplicate harness code -- but does not load it via a plain `page.goto`. Per shot:

1. `page.route` the harness's own `file://` URL and fulfill it with the on-disk HTML plus the theme (and the caret/transition-killing stylesheet) inlined as a `<style>` tag before `</head>`, then `page.goto` that same URL so the route intercepts it. This ordering is load-bearing -- see the callout below.
2. Arm a console wait for `VSCODE_MESSAGE:` containing `"ready"` before/around the `goto`.
3. Feed YAML, branching on harness. For IP Core, pass `fileName` and the optional toolbar fields (`hdlLanguage`, `scaffoldPack`, `toolbarTargets`, `allToolchains`) -- `IpCoreApp.tsx` renders toolbar buttons conditionally on these, so omitting them yields a sparser toolbar than a real user sees.
4. Wait for real content, not just mount: `#root main` **and** the absence of the `Loading memory map...` text. `integration.test.ts` polls on this exact race; a screenshot taken too early captures the loading state.
5. Run `shot.setup`, then `page.screenshot()` or `page.locator(shot.clip).screenshot()`.

!!! warning "Theme injection must land before the bundle's own `<script>` runs"
Text/dropdown inputs are `@vscode/webview-ui-toolkit` custom elements (`<vscode-text-field>`, `<vscode-dropdown>`). Each one reads a `--vscode-*` custom property into its own internal design token (e.g. `--input-background` from `--vscode-input-background`) **once**, the moment it first connects to the DOM -- not as a live `var()` binding. A `page.addStyleTag()` call issued after `page.goto()` (even one that runs before any YAML is rendered) is too late: the app has already mounted, every token has already snapshotted the still-unset variable, and it permanently falls back to the toolkit's own hardcoded default (`#3c3c3c` for `--input-background`) regardless of theme. That default happens to look plausible in a _dark_ theme and was easy to miss; in a _light_ theme it renders as a dark-gray box no one would mistake for correct.

    `page.addInitScript()` does not fix this either -- content it appends to `document.documentElement` before navigation gets discarded once the real HTML parser starts writing `<head>`/`<body>` for the navigated document. Routing the request and inlining the `<style>` directly into the served HTML is the only ordering that reliably lands before the bundle's `<script>` tag executes.

### Theming

The webview uses **68 distinct `var(--vscode-*)` references with no fallback value** (87 counting ones that do have a literal fallback baked into the source). In a bare browser these resolve to nothing and the UI renders broken. A theme stylesheet is therefore a hard prerequisite, not a polish step.

Two ways to produce one, in order of preference:

**1. Live devtools dump (pixel-exact, manual).** VS Code injects every `--vscode-*` value as inline style on `document.documentElement`, so a one-time dump captures them exactly. Run in the devtools console of a live IPCraft webview (Help -> Toggle Developer Tools with an editor open, under the color theme you want to capture):

```js
copy(
  ':root{' +
    Array.from(document.documentElement.style)
      .filter((n) => n.startsWith('--vscode-'))
      .map((n) => `${n}:${document.documentElement.style.getPropertyValue(n)}`)
      .join(';') +
    '}'
);
```

Paste the clipboard contents into the target `theme/*.css` file.

**2. Offline extraction from the installed VS Code app (no live session needed).** `theme/dark.css`, `theme/light.css`, and `theme/dracula.css` were produced this way, not via the dump above. For a bundled theme (Dark Modern, Light Modern), read `extensions/theme-defaults/themes/<name>.json` inside `/Applications/Visual Studio Code.app/Contents/Resources/app`; for an installed theme extension (Dracula), read its own `theme/*.json` under `~/.vscode/extensions/<publisher>.<name>-<version>/`. Either way that JSON's `colors` map only covers what the theme _overrides_ -- resolve everything else against VS Code's core color registry, whose literal `dark`/`light` defaults are readable directly out of the shipped `out/vs/workbench/workbench.desktop.main.js` (search for `oe("<colorId>",{dark:"#...",light:"#...",...`). A handful of colors are neither theme-overridden nor a registry literal -- VS Code derives them at runtime via a lighten/opacity blend of another color (e.g. `statusBarItem.warningBackground` is `editorWarning.foreground` at 40% alpha). These are approximated by hand from the theme's own base color and marked `/* APPROXIMATED */` in the generated CSS; everything else is authoritative, not guessed.

To add another installed theme as a screenshot option: repeat step 2 against that theme's own `colors` map, save as `theme/<name>.css`, and point `THEME_FILE.dark` in `harness.ts` at it.

### Config

`config/playwright.docs.ts` is separate from `config/playwright.config.ts` so `npm run test:browser` (whose `testDir` is `src/test/browser`) is untouched and CI does not generate images on every PR.

```ts
testDir: '../scripts/docs-screenshots',
use: { headless: true },
projects: [{
  name: 'chromium',
  use: { ...devices['Desktop Chrome'], deviceScaleFactor: 2 },
}],
outputDir: '../test-results/docs-screenshots',
```

`package.json` runs the webview webpack build in the `predocs:screenshots`
lifecycle hook before Playwright. This ensures the ignored `dist/webview.*`
and `dist/ipcore.*` bundles always reflect the current source when screenshots
are generated.

`npm run docs:screenshots` therefore works from a clean tree without a separate
compile step. It builds only the webview webpack configuration, avoiding the
extension bundle and its `ipcraft-spec` submodule dependency.

## Wiring images into docs

Both themes are still captured (`-dark.png` and `-light.png` per shot), but docs pages embed **only the light PNG**, unsuffixed -- no `#only-dark`/`#only-light` pair and no MkDocs Material theme-toggle switching:

```md
![Memory Map editor](../images/memorymap-editor-light.png)
```

Light was chosen over the dark/light toggle because these docs get printed, and a dark screenshot on paper wastes toner and reads poorly. The `-dark.png` files stay in `docs/images/` (harmless, generated automatically) in case the toggle is reinstated later, but no markdown file should reference them.

`README.md` has no theme toggle and embeds the light variants of the IP Core, Memory Map, and Data Inspector images. Relative README image paths resolve against the repo on both GitHub and the Marketplace.

At 2x scale these PNGs are large -- the existing hand-captured ones are around 0.5 MB each. If the committed total becomes uncomfortable, run `oxipng` or `pngquant` as a post-step.

## Reusing this content outside MkDocs

The docs are deliberately structured so a `docs/how-to/*.md` file plus its `docs/images/*-light.png` screenshots is the reusable unit, not the MkDocs site as a whole. Three concrete paths, in increasing order of manual work:

**MkDocs (this site).** Already true today -- `mkdocs build --strict` renders every how-to guide with no broken links or images; that is the regression check for this whole system (see Verification below).

**A plain static site or hand-built HTML page.** `docs/index.html` is the working proof: it is hand-authored HTML (no MkDocs, no build step) that embeds the exact same `docs/images/*-light.png` files the how-to guides use, with a light/dark toggle swapping `data-dark`/`data-light` attributes. Any static site generator (Jekyll, Hugo, Docusaurus, plain `pandoc`) can render the how-to guides the same way, because they are CommonMark: headers, tables, fenced code, and `![alt](../images/x-light.png)` image links -- nothing MkDocs-specific. The exceptions are a handful of files that opt into MkDocs Material extensions and degrade gracefully rather than break outside it: `!!! note`/`!!! warning` admonitions (`scaffold-packs.md` and several tutorials) render as an ordinary paragraph starting with `!!! note "..."` in plain CommonMark, and `=== "Tab"` blocks (`build-vsix.md`) render as a literal `=== "Tab"` line. The how-to guides that document IPCraft's flagship capabilities -- `create-your-first-ip-core.md`, `custom-interfaces.md`, `check-consistency.md`, `use-data-inspector.md`, `vhdl-import.md`, `generating-a-project.md`, `building-a-project.md` -- use none of these extensions and round-trip through any CommonMark renderer unchanged.

**WordPress (or another CMS without repo-relative image access).** WordPress can't resolve `../images/x-light.png` -- a post needs an absolute media URL. The one-time, per-guide conversion is:

1. Upload the guide's referenced `docs/images/*-light.png` files to the Media Library.
2. Paste the guide's Markdown body into a Markdown-aware block (the Jetpack Markdown block, or any Markdown-to-blocks importer plugin), or run it through `pandoc guide.md -o guide.html` first and paste the result into a Custom HTML block.
3. Replace each `../images/<id>-light.png` reference with the uploaded attachment's URL -- a single find-and-replace per image, since every guide follows the same `<id>-light.png` naming convention and never references a `-dark.png` file (see "Wiring images into docs" above).

No image re-export or screenshot re-capture is needed for any of the three paths -- they all consume the same PNGs this pipeline already produces.

## Verification

1. `npm run docs:screenshots` -- build the current webview source and expect 30 PNGs (15 shots x 2 themes) in `docs/images/`.
2. Compare `memorymap-editor-dark.png` against a real VS Code editor under the same theme. Colors, fonts and control chrome should match. Large transparent or black areas, or invisible text, mean a theme variable is missing.
3. Confirm no image shows `Loading memory map...`.
4. `pip install -r docs/requirements.txt && mkdocs serve` -- check the light-theme images render correctly on the served pages.
5. `npm run test:browser` -- must still pass unchanged, proving the docs config did not leak into the test run.
6. Deliberately break one shot's `setup` selector and confirm the run fails rather than emitting a wrong image.
