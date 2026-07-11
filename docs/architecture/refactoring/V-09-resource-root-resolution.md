# V-9 — Centralized Resource Root Resolution

> Status: **Implemented** (see `src/services/ResourceRoots.ts`) · Severity: Medium (fails late, environment-dependent) · Effort: S (1 day)
> Independent of other V-items
> Source finding: [architecture.md §7 V-9](../architecture.md#v-9--path-resolution-heuristics-for-packaged-vs-dev-vs-test-runtime)

## Why

Three modules independently re-derive where bundled resources live, each with its own
fallback chain over `__dirname`:

| Site | Chain | Failure mode if all miss |
| --- | --- | --- |
| `IpCoreScaffolder.ts:37` `IP_CORE_SCHEMA_PATH` | `dist/resources/schemas/` → `../ipcraft-spec/schemas/` → `../../ipcraft-spec/schemas/` | Returns a non-existent path; AJV load throws at **generation time** |
| `ScaffoldPackLoader.ts:7` `BUILTIN_PACKS_DIR` | `__dirname/packs` → `../src/generator/packs` | `listBuiltinPacks()` returns `[]`, `resolve()` throws at generation time |
| `TemplateLoader.ts:92` `resolveTemplatesPath` | `__dirname/templates` → **`process.cwd()`** | Silently treats the user's CWD as the template root; Nunjucks then fails with "template not found" — or worse, finds an unrelated file |

The chains exist because `__dirname` means different things per runtime: webpack bundle
(`dist/`), ts-jest (`src/generator/`), packaged VSIX. Each module rediscovered this the hard
way (the long comment block in `IpCoreScaffolder` documents one such incident).

Problems:

1. **Fails late and environment-specifically.** A wrong fallback is invisible at activation;
   it surfaces as a generation error on the user's machine in exactly the environment CI
   didn't cover. The `process.cwd()` fallback can even *succeed wrongly*.
2. **Hidden global state.** Module-level IIFE constants evaluate at import time, so tests
   can't substitute paths without module-mocking gymnastics.
3. **The correct anchor already exists and is ignored.** VS Code hands us
   `context.extensionPath`/`extensionUri` — the one authoritative root, valid in dev, test
   (via `@vscode/test-electron`), and packaged installs. `HtmlGenerator` and
   `GenerateCommands.viewBusDefinitions` already use it; the generator modules don't because
   they also run under plain ts-jest where no `ExtensionContext` exists — which is a
   dependency-injection problem, not a path-guessing problem.

## Design goals

1. **Resolve once, at activation, from `extensionPath`.** Every consumer receives paths;
   nobody guesses.
2. **Fail fast.** Missing resource roots are detected at activation (or generator
   construction) with a clear error naming the expected path — not mid-generation.
3. **Tests inject explicitly.** ts-jest suites pass repo-relative paths; no `__dirname`
   archaeology.

## How

```ts
// src/services/ResourceRoots.ts
export interface ResourceRoots {
  readonly schemasDir: string;        // <ext>/dist/resources/schemas
  readonly builtinPacksDir: string;   // <ext>/dist/packs
  readonly templatesDir: string;      // <ext>/dist/templates
  readonly busDefinitionsDir: string; // <ext>/dist/resources/bus_definitions
}

export function resolveResourceRoots(extensionPath: string): ResourceRoots; // throws listing
                                                                            // any missing dir
export function devResourceRoots(repoRoot: string): ResourceRoots;          // for ts-jest:
                                                                            // src/generator/packs, ipcraft-spec/schemas, …
```

- `activate()` calls `resolveResourceRoots(context.extensionPath)` once; a failure logs and
  surfaces a single actionable error ("IPCraft installation is missing `dist/packs` — broken
  package?") instead of N downstream mysteries.
- Constructor injection downstream: `IpCoreScaffolder`, `ScaffoldPackLoader` (becomes an
  instance or takes the dir per call — currently all-static with a module-level constant),
  `TemplateLoader` (already takes paths — just stop calling `resolveTemplatesPath()` as a
  static fallback), `BusLibraryService`.
- The three fallback chains and the `process.cwd()` escape hatch are deleted.
- Webpack copy rules (`CopyWebpackPlugin`) are the contract's other half: add a build-time
  assertion script (or a packaging smoke test) that the four dirs exist in `dist/` after
  `npm run package` — this pins the layout the resolver expects.

## Tasks

1. **Inventory + contract test** (S). Grep all `__dirname` uses outside tests; write the
   packaging smoke test asserting the `dist/` layout (run in CI after the package step).
   This documents the current layout before anything moves.
2. **Implement `ResourceRoots`** (S). Both factory functions + unit tests (missing-dir error
   message includes the path).
3. **Inject into the generator stack** (S–M). `IpCoreScaffolder`, `ScaffoldPackLoader`,
   `TemplateLoader`, `BusLibraryService` constructors take what they need;
   `GenerateCommands`/`IpCoreGenerateHandler`/`TemplatePreviewProvider` thread the roots from
   activation. ts-jest suites switch to `devResourceRoots(repoRoot)` — deleting their
   implicit dependence on `__dirname` landing in `src/generator/`.
4. **Delete the chains** (S). Remove the three IIFEs and `resolveTemplatesPath`'s cwd
   fallback. The long explanatory comment in `IpCoreScaffolder` moves (condensed) to
   `ResourceRoots` as the single place this knowledge lives.

## Acceptance criteria

- `grep -rn "__dirname" src/ --include='*.ts' | grep -v test` hits only `ResourceRoots.ts`
  (and webview-irrelevant files, if any).
- No `process.cwd()` in resource resolution.
- Packaging smoke test in CI fails if a webpack copy rule is removed.
- A deliberately broken install (rename `dist/packs`) produces one clear activation-time
  error instead of a generation-time stack trace.

## Risks

- `ScaffoldPackLoader` is consumed statically from several places (`IpCoreEditorProvider`
  toolbar pack listing, `ScaffoldPackCommands`); converting to instances touches them all.
  Mechanical, but enumerate call sites first (task 1 inventory covers this).
- Watch for the walkthrough/example-pack export path (`exportScaffoldPack`) which reads
  built-in packs — include it in task 3.
