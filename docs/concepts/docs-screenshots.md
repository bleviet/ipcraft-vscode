# Automated Docs Screenshots

Generating documentation images from the real compiled webview, driven by a declarative manifest.

## Why

`docs/` has ~50 markdown pages and no images. The only screenshots in the repo are two hand-captured PNGs in `resources/screenshots/`, referenced from `README.md`. Because they are captured by hand, they drift silently whenever the UI changes.

The browser test harness in `src/test/browser/` already loads the real compiled webview bundles and renders real YAML. Screenshot generation is therefore not new infrastructure -- it is one additional consumer of an existing harness.

## Goals

- One command regenerates every docs image from live code, so images cannot silently go stale.
- Adding an image for a new concept is a one-entry data change, not new Playwright boilerplate.
- A UI change that invalidates a screenshot fails loudly instead of producing a quietly wrong image.

## The maintenance model

Everything is driven by a manifest. One entry describes one image; a generic runner loops over the manifest and captures each entry in both themes.

| Situation | What you do |
|-----------|-------------|
| New concept needs an image | Append one entry to `shots.ts`, add one markdown image pair |
| UI changed | Rerun `npm run docs:screenshots`; all images move forward together |
| UI change breaks a shot | The `setup` selector fails and the run errors |

Images are never hand-edited. The manifest is the source of truth for which images exist; the compiled bundle is the source of truth for how they look.

There is deliberately **no CI staleness gate**. Regenerating on every PR would force a PNG refresh commit into each UI change and make diffs noisy. This stays a command the developer runs when docs matter.

## Existing harness

Two standalone HTML pages, loaded over `file://` with no dev server:

| Harness | Root | Bundles | Data injection |
|---------|------|---------|----------------|
| `src/test/browser/index.html` | `#root` | `dist/webview.{js,css}` | `window.__RENDER__(text)` |
| `src/test/browser/ipcore.html` | `#ipcore-root` | `dist/ipcore.{js,css}` | `window.postMessage({type:'update', text, fileName}, '*')` |

Both stub `acquireVsCodeApi` inline before the bundle script tag -- required, because `src/webview/vscode.ts` calls it at module load. Both signal readiness by posting `{type:'ready'}`, which the stub logs with a `VSCODE_MESSAGE:` prefix.

The asymmetry matters: `__RENDER__` is registered only in `src/webview/index.tsx`. The IP Core app has no equivalent and must be fed through `postMessage`.

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
  id: string;                             // -> docs/images/<id>-{dark,light}.png
  harness: 'memorymap' | 'ipcore';
  source: string;                         // repo-relative YAML path
  viewport?: { width: number; height: number };
  clip?: string;                          // optional selector -> capture one element
  setup?: (page: Page) => Promise<void>;  // clicks/expansion before capture
}
```

Source YAML comes from `examples/led_avmm/led_controller_avmm.{ip,mm}.yml` -- real, hardware-validated specs that the LED controller tutorials already walk through, so screenshots and prose describe the same design. The `src/test/fixtures/` files are deliberately minimal and would render a thin, unconvincing UI.

Initial manifest:

| id | Harness | Capture | Used by |
|----|---------|---------|---------|
| `memorymap-editor` | memorymap | full | `README.md`, `docs/index.md` |
| `ipcore-editor` | ipcore | full | `README.md`, `docs/index.md`, "Scaffolding the project" |
| `outline-tree` | memorymap | `aside.sidebar` | "The register map" |
| `bitfield-visualizer` | memorymap | `main section` | "The register map" (LED_PATTERN) |
| `fields-table-access` | memorymap | `[data-fields-table="true"] table` | "The register map" (EVENTS, `monitorChangeOf`) |

All four tutorial placements are in `docs/tutorials/led-controller-avmm-authoring.md` -- not `memory-mapped-registers.md`, whose worked example is `daq_controller`, a different fixture. The `EVENTS` register in the LED example is write-1-to-clear with `monitorChangeOf`, which is exactly what that tutorial's register-map section describes, and its register-map table matches the LED example field-for-field.

### Capture sequence

The runner reuses the existing harness HTML unmodified on disk -- no duplicate harness code -- but does not load it via a plain `page.goto`. Per shot:

1. `page.route` the harness's own `file://` URL and fulfill it with the on-disk HTML plus the theme (and the caret/transition-killing stylesheet) inlined as a `<style>` tag before `</head>`, then `page.goto` that same URL so the route intercepts it. This ordering is load-bearing -- see the callout below.
2. Arm a console wait for `VSCODE_MESSAGE:` containing `"ready"` before/around the `goto`.
3. Feed YAML, branching on harness. For IP Core, pass `fileName` and the optional toolbar fields (`hdlLanguage`, `scaffoldPack`, `toolbarTargets`, `allToolchains`) -- `IpCoreApp.tsx` renders toolbar buttons conditionally on these, so omitting them yields a sparser toolbar than a real user sees.
4. Wait for real content, not just mount: `#root main` **and** the absence of the `Loading memory map...` text. `integration.test.ts` polls on this exact race; a screenshot taken too early captures the loading state.
5. Run `shot.setup`, then `page.screenshot()` or `page.locator(shot.clip).screenshot()`.

!!! warning "Theme injection must land before the bundle's own `<script>` runs"
    Text/dropdown inputs are `@vscode/webview-ui-toolkit` custom elements (`<vscode-text-field>`, `<vscode-dropdown>`). Each one reads a `--vscode-*` custom property into its own internal design token (e.g. `--input-background` from `--vscode-input-background`) **once**, the moment it first connects to the DOM -- not as a live `var()` binding. A `page.addStyleTag()` call issued after `page.goto()` (even one that runs before any YAML is rendered) is too late: the app has already mounted, every token has already snapshotted the still-unset variable, and it permanently falls back to the toolkit's own hardcoded default (`#3c3c3c` for `--input-background`) regardless of theme. That default happens to look plausible in a *dark* theme and was easy to miss; in a *light* theme it renders as a dark-gray box no one would mistake for correct.

    `page.addInitScript()` does not fix this either -- content it appends to `document.documentElement` before navigation gets discarded once the real HTML parser starts writing `<head>`/`<body>` for the navigated document. Routing the request and inlining the `<style>` directly into the served HTML is the only ordering that reliably lands before the bundle's `<script>` tag executes.

### Theming

The webview uses **68 distinct `var(--vscode-*)` references with no fallback value** (87 counting ones that do have a literal fallback baked into the source). In a bare browser these resolve to nothing and the UI renders broken. A theme stylesheet is therefore a hard prerequisite, not a polish step.

Two ways to produce one, in order of preference:

**1. Live devtools dump (pixel-exact, manual).** VS Code injects every `--vscode-*` value as inline style on `document.documentElement`, so a one-time dump captures them exactly. Run in the devtools console of a live IPCraft webview (Help -> Toggle Developer Tools with an editor open, under the color theme you want to capture):

```js
copy(':root{' + Array.from(document.documentElement.style)
  .filter(n => n.startsWith('--vscode-'))
  .map(n => `${n}:${document.documentElement.style.getPropertyValue(n)}`)
  .join(';') + '}');
```

Paste the clipboard contents into the target `theme/*.css` file.

**2. Offline extraction from the installed VS Code app (no live session needed).** `theme/dark.css`, `theme/light.css`, and `theme/dracula.css` were produced this way, not via the dump above. For a bundled theme (Dark Modern, Light Modern), read `extensions/theme-defaults/themes/<name>.json` inside `/Applications/Visual Studio Code.app/Contents/Resources/app`; for an installed theme extension (Dracula), read its own `theme/*.json` under `~/.vscode/extensions/<publisher>.<name>-<version>/`. Either way that JSON's `colors` map only covers what the theme *overrides* -- resolve everything else against VS Code's core color registry, whose literal `dark`/`light` defaults are readable directly out of the shipped `out/vs/workbench/workbench.desktop.main.js` (search for `oe("<colorId>",{dark:"#...",light:"#...",...`). A handful of colors are neither theme-overridden nor a registry literal -- VS Code derives them at runtime via a lighten/opacity blend of another color (e.g. `statusBarItem.warningBackground` is `editorWarning.foreground` at 40% alpha). These are approximated by hand from the theme's own base color and marked `/* APPROXIMATED */` in the generated CSS; everything else is authoritative, not guessed.

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

MkDocs Material's theme toggle is honoured via suffixes:

```md
![Memory Map editor](../images/memorymap-editor-dark.png#only-dark)
![Memory Map editor](../images/memorymap-editor-light.png#only-light)
```

`README.md` has no theme toggle and stays dark-only. Its two image links move from `resources/screenshots/` to `docs/images/`, and `resources/screenshots/` is deleted so there is a single generated source of truth. Relative README image paths resolve against the repo on both GitHub and the Marketplace, so this keeps working.

At 2x scale these PNGs are large -- the existing hand-captured ones are around 0.5 MB each. If the committed total becomes uncomfortable, run `oxipng` or `pngquant` as a post-step.

## Verification

1. `npm run docs:screenshots` -- build the current webview source and expect 10 PNGs (5 shots x 2 themes) in `docs/images/`.
2. Compare `memorymap-editor-dark.png` against a real VS Code editor under the same theme. Colors, fonts and control chrome should match. Large transparent or black areas, or invisible text, mean a theme variable is missing.
3. Confirm no image shows `Loading memory map...`.
4. `pip install -r docs/requirements.txt && mkdocs serve` -- check images render and that the site's light/dark switch swaps them.
5. `npm run test:browser` -- must still pass unchanged, proving the docs config did not leak into the test run.
6. Deliberately break one shot's `setup` selector and confirm the run fails rather than emitting a wrong image.
