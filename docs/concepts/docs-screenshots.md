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
    +-- dark.css      # committed dump output (Dark Modern)
    +-- light.css     # committed dump output (Light Modern)
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
| `ipcore-editor` | ipcore | full | `README.md`, `docs/index.md` |
| `outline-tree` | memorymap | outline panel | Anatomy of a memory map |
| `bitfield-visualizer` | memorymap | visualizer pane | Bit fields |
| `fields-table-access` | memorymap | `[data-fields-table="true"]` | Access types, Change-of-state fields |
| `register-map-visualizer` | memorymap | visualizer | Resulting address map |

The last four target sections of `docs/tutorials/memory-mapped-registers.md`. The `EVENTS` register in the LED example is write-1-to-clear with `monitorChangeOf`, which is exactly what the change-of-state section describes.

### Capture sequence

The runner reuses the existing harness HTML unmodified -- no duplicate harness code. Per shot:

1. Arm a console wait for `VSCODE_MESSAGE:` containing `"ready"`, then `page.goto` the `file://` harness.
2. Inject the theme with `page.addStyleTag`, plus a stylesheet disabling transitions, animations and the text caret so captures are deterministic.
3. Feed YAML, branching on harness. For IP Core, pass `fileName` and the optional toolbar fields (`hdlLanguage`, `scaffoldPack`, `toolbarTargets`, `allToolchains`) -- `IpCoreApp.tsx` renders toolbar buttons conditionally on these, so omitting them yields a sparser toolbar than a real user sees.
4. Wait for real content, not just mount: `#root main` **and** the absence of the `Loading memory map...` text. `integration.test.ts` polls on this exact race; a screenshot taken too early captures the loading state.
5. Run `shot.setup`, then `page.screenshot()` or `page.locator(shot.clip).screenshot()`.

### Theming

The webview uses **68 distinct `var(--vscode-*)` references with no fallback value**. In a bare browser these resolve to nothing and the UI renders broken. A theme stylesheet is therefore a hard prerequisite, not a polish step.

VS Code injects these as inline style on `document.documentElement`, so a one-time dump captures them exactly. Run in the devtools console of a live IPCraft webview (Help -> Toggle Developer Tools with an editor open):

```js
copy(':root{' + Array.from(document.documentElement.style)
  .filter(n => n.startsWith('--vscode-'))
  .map(n => `${n}:${document.documentElement.style.getPropertyValue(n)}`)
  .join(';') + '}');
```

Run once under Dark Modern, save as `theme/dark.css`; switch theme, run again for `theme/light.css`. Committed thereafter, so no manual step recurs.

### Config

`config/playwright.docs.ts` is separate from `config/playwright.config.ts` so `npm run test:browser` (whose `testDir` is `src/test/browser`) is untouched and CI does not generate images on every PR.

```ts
testDir: '../scripts/docs-screenshots',
use: { deviceScaleFactor: 2, headless: true },   // 2x for crisp docs images
outputDir: '../test-results/docs-screenshots',
```

`package.json` gains `"docs:screenshots": "playwright test --config config/playwright.docs.ts"`.

`dist/` does not exist in a clean tree and `test:browser` does not build it. Run `npm run compile` first, or `webpack --config config/webpack.config.js --config-name webview` to skip the extension bundle and avoid needing the `ipcraft-spec` submodule.

## Wiring images into docs

MkDocs Material's theme toggle is honoured via suffixes:

```md
![Memory Map editor](../images/memorymap-editor-dark.png#only-dark)
![Memory Map editor](../images/memorymap-editor-light.png#only-light)
```

`README.md` has no theme toggle and stays dark-only. Its two image links move from `resources/screenshots/` to `docs/images/`, and `resources/screenshots/` is deleted so there is a single generated source of truth. Relative README image paths resolve against the repo on both GitHub and the Marketplace, so this keeps working.

At 2x scale these PNGs are large -- the existing hand-captured ones are around 0.5 MB each. If the committed total becomes uncomfortable, run `oxipng` or `pngquant` as a post-step.

## Verification

1. `npm run compile` -- confirm `dist/webview.{js,css}` and `dist/ipcore.{js,css}` exist.
2. `npm run docs:screenshots` -- expect 12 PNGs (6 shots x 2 themes) in `docs/images/`.
3. Compare `memorymap-editor-dark.png` against the old `resources/screenshots/memorymap-editor.png`. Colors, fonts and control chrome should match a real VS Code editor. Large transparent or black areas, or invisible text, mean the variable dump is incomplete.
4. Confirm no image shows `Loading memory map...`.
5. `pip install -r docs/requirements.txt && mkdocs serve` -- check images render and that the site's light/dark switch swaps them.
6. `npm run test:browser` -- must still pass unchanged, proving the docs config did not leak into the test run.
7. Deliberately break one shot's `setup` selector and confirm the run fails rather than emitting a wrong image.
